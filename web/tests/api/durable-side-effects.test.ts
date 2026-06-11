/**
 * T15 (#83) — durable audit/notification writes: no more fire-and-forget.
 *
 * On Vercel a function can freeze the moment the response is sent, so a
 * detached `void (async () => ...)()` may never run (see lib/jobs.ts header).
 * These tests pin the fixed contract:
 *
 *   1. `logAudit` / `createNotification` return a promise that settles only
 *      after the insert has settled — and NEVER reject (swallow-and-log), so
 *      a failed side-effect write can't fail the user's mutation.
 *   2. By the time a mutation route's response resolves, its audit_log /
 *      notifications rows are already committed — no waitFor, no polling.
 *      (Before the fix these assertions race the detached write.)
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { POST as waiveRoute } from "@/app/api/deals/[id]/fee/waive/route";
import { PATCH as advanceStageRoute } from "@/app/api/deals/[id]/stage/route";
import { POST as postMessageRoute } from "@/app/api/deals/[id]/messages/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser, createDeal } from "../helpers/factories";

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
});

beforeEach(async () => {
  await truncateAll();
});

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const MISSING_USER = "00000000-0000-0000-0000-000000000000";

// ── 1. helper-level contract (deterministic) ───────────────────────────────

describe("logAudit / createNotification durability contract", () => {
  it("logAudit returns a promise; the row is committed once it resolves", async () => {
    const actor = await createUser({ role: "admin" });
    const returned: unknown = logAudit({
      actorId: actor.id,
      eventType: "contract_probe",
    });
    // Fire-and-forget returned undefined — the write could outlive the request.
    expect(returned).toBeInstanceOf(Promise);
    await returned;
    expect(
      await prisma.audit_log.count({ where: { event_type: "contract_probe" } })
    ).toBe(1);
  });

  it("createNotification returns a promise; the row is committed once it resolves", async () => {
    const user = await createUser({ role: "buyer" });
    const returned: unknown = createNotification({
      userId: user.id,
      title: "Probe",
      body: "contract probe",
      kind: "info",
    });
    expect(returned).toBeInstanceOf(Promise);
    await returned;
    expect(
      await prisma.notifications.count({ where: { user_id: user.id } })
    ).toBe(1);
  });

  it("a failing write resolves anyway (swallow-and-log) — it must never fail the mutation", async () => {
    // FK violation: the user does not exist. Both helpers must swallow.
    await expect(
      Promise.resolve(
        createNotification({
          userId: MISSING_USER,
          title: "t",
          body: "b",
          kind: "info",
        })
      )
    ).resolves.toBeUndefined();
    await expect(
      Promise.resolve(
        logAudit({ actorId: MISSING_USER, eventType: "swallow_probe" })
      )
    ).resolves.toBeUndefined();
  });
});

// ── 2. route-level: rows exist by the time the response resolves ───────────

describe("side-effect rows exist by the time the mutation responds", () => {
  it("fee waive: the audit_log row is committed before the response resolves", async () => {
    const agent = await createUser({ role: "agent" });
    const deal = await createDeal({ agent_id: agent.id });
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin-t15" });

    const res = await waiveRoute(
      new Request(`http://localhost/api/deals/${deal.id}/fee/waive`, {
        method: "POST",
        headers: { authorization: await authHeader("auth0|admin-t15", ["admin"]) },
      }),
      ctx(deal.id)
    );
    expect(res.status).toBe(200);

    // No waitFor, no polling — the row must already be there.
    const row = await prisma.audit_log.findFirst({
      where: { event_type: "fee_waive", deal_id: deal.id },
    });
    expect(row).not.toBeNull();
    expect(row?.actor_id).toBe(admin.id);
  });

  it("stage advance: audit row + participant notification committed before the response resolves", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent-t15" });
    const buyer = await createUser({ role: "buyer" });
    const deal = await createDeal({ agent_id: agent.id, stage: "intake" });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });

    const res = await advanceStageRoute(
      new Request(`http://localhost/api/deals/${deal.id}/stage`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|agent-t15", ["agent"]),
        },
        body: JSON.stringify({ stage: "active_search" }),
      }),
      ctx(deal.id)
    );
    expect(res.status).toBe(200);

    const audit = await prisma.audit_log.findFirst({
      where: { event_type: "stage_change", deal_id: deal.id },
    });
    expect(audit?.actor_id).toBe(agent.id);

    const notif = await prisma.notifications.findFirst({
      where: { user_id: buyer.id, deal_id: deal.id, type: "stage_change" },
    });
    expect(notif?.body).toBe("New stage: Property Search");
  });

  it("message post: the recipient's notification is committed before the response resolves", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent-msg-t15" });
    const buyer = await createUser({ role: "buyer" });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });

    const res = await postMessageRoute(
      new Request(`http://localhost/api/deals/${deal.id}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|agent-msg-t15", ["agent"]),
        },
        body: JSON.stringify({
          channel: "client_thread",
          body: "Inspection is set for Friday",
        }),
      }),
      ctx(deal.id)
    );
    expect(res.status).toBe(201);

    const notif = await prisma.notifications.findFirst({
      where: { user_id: buyer.id, deal_id: deal.id, type: "new_message" },
    });
    expect(notif?.body).toBe("Inspection is set for Friday");
  });
});
