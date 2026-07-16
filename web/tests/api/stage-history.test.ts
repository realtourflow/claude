/**
 * GET /api/deals/[id]/stage-history (#256).
 *
 * Real per-stage durations on the Timeline tab are derived from
 * `deal_stage_history`, but until this endpoint existed nothing exposed those
 * rows to the UI (only lib/deals.ts's health CASE read the table). This route
 * returns the ordered transition log, scoped with the same read access as
 * GET /api/deals/[id] (#167: agent owner, participant, linked TC, or admin).
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { GET as stageHistoryRoute } from "@/app/api/deals/[id]/stage-history/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { DealStage } from "@/lib/stages";
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

/** Insert a stage-history row directly, with an explicit changed_at. */
async function addHistory(
  dealId: string,
  changedBy: string,
  from: DealStage | null,
  to: DealStage,
  changedAt: Date
): Promise<void> {
  await prisma.deal_stage_history.create({
    data: {
      deal_id: dealId,
      from_stage: from as DealStage,
      to_stage: to as DealStage,
      changed_by: changedBy,
      changed_at: changedAt,
    },
  });
}

async function get(dealId: string, sub: string, roles: string[]) {
  const req = new Request(`http://localhost/api/deals/${dealId}/stage-history`, {
    headers: { authorization: await authHeader(sub, roles) },
  });
  return stageHistoryRoute(req, ctx(dealId));
}

type WireRow = {
  from_stage: string | null;
  to_stage: string;
  changed_at: string;
  changed_by: string;
};

describe("GET /api/deals/[id]/stage-history", () => {
  it("returns 401 without auth", async () => {
    const res = await stageHistoryRoute(
      new Request("http://localhost/api/deals/00000000-0000-0000-0000-000000000000/stage-history"),
      ctx("00000000-0000-0000-0000-000000000000")
    );
    expect(res.status).toBe(401);
  });

  // Case 1 (fails today: the route did not exist → 404).
  it("returns transition rows ordered by changed_at with from/to/changed_at", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id, stage: "offer_active" });

    const t1 = new Date("2026-01-06T00:00:00.000Z"); // intake -> active_search
    const t2 = new Date("2026-01-26T00:00:00.000Z"); // active_search -> offer_active
    // Insert out of chronological order to prove the route sorts ascending.
    await addHistory(deal.id, agent.id, "active_search", "offer_active", t2);
    await addHistory(deal.id, agent.id, "intake", "active_search", t1);

    const res = await get(deal.id, "auth0|a", ["agent"]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as WireRow[];

    expect(body.length).toBe(2);
    expect(body[0].from_stage).toBe("intake");
    expect(body[0].to_stage).toBe("active_search");
    expect(new Date(body[0].changed_at).toISOString()).toBe(t1.toISOString());
    expect(body[1].from_stage).toBe("active_search");
    expect(body[1].to_stage).toBe("offer_active");
    expect(new Date(body[1].changed_at).toISOString()).toBe(t2.toISOString());
    // changed_by is exposed for attribution.
    expect(body[0].changed_by).toBe(agent.id);
  });

  it("returns an empty array for a deal with no transitions", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });

    const res = await get(deal.id, "auth0|a", ["agent"]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as WireRow[];
    expect(body).toEqual([]);
  });

  // Case 2: same read scoping as GET /api/deals/[id] (#167 / #235).
  it("404 for a stranger with no access", async () => {
    const owner = await createUser({ role: "agent", auth0_id: "auth0|owner" });
    await createUser({ role: "agent", auth0_id: "auth0|stranger" });
    const deal = await createDeal({ agent_id: owner.id });
    await addHistory(deal.id, owner.id, "intake", "active_search", new Date());

    const res = await get(deal.id, "auth0|stranger", ["agent"]);
    expect(res.status).toBe(404);
  });

  it("200 for a deal participant (read access)", async () => {
    const owner = await createUser({ role: "agent", auth0_id: "auth0|owner" });
    const buyer = await createUser({ role: "buyer", auth0_id: "auth0|buyer" });
    const deal = await createDeal({ agent_id: owner.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });
    await addHistory(deal.id, owner.id, "intake", "active_search", new Date());

    const res = await get(deal.id, "auth0|buyer", ["buyer"]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as WireRow[];
    expect(body.length).toBe(1);
  });

  it("200 for a TC linked to the deal's owning agent (#167)", async () => {
    const tc = await createUser({ role: "tc", auth0_id: "auth0|tc-linked" });
    const agent = await createUser({ role: "agent" });
    await prisma.users.update({
      where: { id: agent.id },
      data: { tc_user_id: tc.id },
    });
    const deal = await createDeal({ agent_id: agent.id });
    await addHistory(deal.id, agent.id, "intake", "active_search", new Date());

    const res = await get(deal.id, "auth0|tc-linked", ["tc"]);
    expect(res.status).toBe(200);
  });

  it("404 for a TC NOT linked to the deal's agent (#167)", async () => {
    await createUser({ role: "tc", auth0_id: "auth0|tc-unlinked" });
    const agent = await createUser({ role: "agent" });
    const deal = await createDeal({ agent_id: agent.id });

    const res = await get(deal.id, "auth0|tc-unlinked", ["tc"]);
    expect(res.status).toBe(404);
  });

  it("200 for admin (#167)", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent" });
    const deal = await createDeal({ agent_id: agent.id });
    await addHistory(deal.id, agent.id, "intake", "active_search", new Date());

    const res = await get(deal.id, "auth0|admin", ["admin"]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as WireRow[];
    expect(body.length).toBe(1);
  });
});
