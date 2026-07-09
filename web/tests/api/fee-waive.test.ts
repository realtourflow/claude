/**
 * POST /api/deals/[id]/fee/waive — tenant scoping + fee_status guard (#180).
 *
 * The waive endpoint must be scoped: only an admin (global) or the deal
 * agent's linked TC (users.tc_user_id = caller) may waive, and only while
 * the fee is still waivable (fee_status IN ('unpaid','pending')). A paid
 * fee must never be silently flipped to waived.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { POST as waiveRoute } from "@/app/api/deals/[id]/fee/waive/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { prisma } from "@/lib/db";
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

async function waive(dealId: string, sub: string, roles: string[]) {
  return waiveRoute(
    new Request(`http://localhost/api/deals/${dealId}/fee/waive`, {
      method: "POST",
      headers: { authorization: await authHeader(sub, roles) },
    }),
    ctx(dealId)
  );
}

async function feeStatus(dealId: string): Promise<string | undefined> {
  const row = await prisma.deals.findUnique({
    where: { id: dealId },
    select: { fee_status: true },
  });
  return row?.fee_status;
}

/** An agent whose linked TC is `tcId` (users.tc_user_id), plus a deal. */
async function agentWithDeal(tcId?: string, feeStatusOverride?: string) {
  const agent = await createUser({ role: "agent" });
  if (tcId) {
    await prisma.users.update({
      where: { id: agent.id },
      data: { tc_user_id: tcId },
    });
  }
  const deal = await createDeal({ agent_id: agent.id });
  if (feeStatusOverride) {
    await prisma.deals.update({
      where: { id: deal.id },
      data: { fee_status: feeStatusOverride },
    });
  }
  return { agent, deal };
}

describe("POST /api/deals/[id]/fee/waive — tenant scoping (#180 case 1)", () => {
  it("403 when a TC waives a fee on a deal whose agent is NOT linked to them", async () => {
    // TC exists but the deal's agent has a DIFFERENT (or no) linked TC.
    await createUser({ role: "tc", auth0_id: "auth0|tc-outsider" });
    const { deal } = await agentWithDeal(); // agent has no tc_user_id at all

    const res = await waive(deal.id, "auth0|tc-outsider", ["tc"]);
    expect(res.status).toBe(403);
    await expect(feeStatus(deal.id)).resolves.toBe("unpaid");
  });

  it("403 when a TC is linked to a different agent than the deal's owner", async () => {
    const tc = await createUser({ role: "tc", auth0_id: "auth0|tc-other" });
    // The TC IS linked to some agent — just not the one who owns this deal.
    await agentWithDeal(tc.id);
    const { deal: foreignDeal } = await agentWithDeal();

    const res = await waive(foreignDeal.id, "auth0|tc-other", ["tc"]);
    expect(res.status).toBe(403);
    await expect(feeStatus(foreignDeal.id)).resolves.toBe("unpaid");
  });

  it("403 when the TC caller has no DB user row (cannot own any agent link)", async () => {
    const { deal } = await agentWithDeal();
    const res = await waive(deal.id, "auth0|tc-ghost", ["tc"]);
    expect(res.status).toBe(403);
    await expect(feeStatus(deal.id)).resolves.toBe("unpaid");
  });
});

describe("POST /api/deals/[id]/fee/waive — status guard (#180 case 2)", () => {
  it("rejects waiving a 'paid' fee and does not overwrite it (admin)", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const { deal } = await agentWithDeal(undefined, "paid");

    const res = await waive(deal.id, "auth0|admin", ["admin"]);
    expect(res.status).toBe(409);
    await expect(feeStatus(deal.id)).resolves.toBe("paid");
  });

  it("rejects waiving a 'paid' fee even for the deal's linked TC", async () => {
    const tc = await createUser({ role: "tc", auth0_id: "auth0|tc-linked" });
    const { deal } = await agentWithDeal(tc.id, "paid");

    const res = await waive(deal.id, "auth0|tc-linked", ["tc"]);
    expect(res.status).toBe(409);
    await expect(feeStatus(deal.id)).resolves.toBe("paid");
  });

  it("rejects re-waiving an already 'waived' fee", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const { deal } = await agentWithDeal(undefined, "waived");

    const res = await waive(deal.id, "auth0|admin", ["admin"]);
    expect(res.status).toBe(409);
    await expect(feeStatus(deal.id)).resolves.toBe("waived");
  });
});

describe("POST /api/deals/[id]/fee/waive — allowed callers (#180 case 3)", () => {
  it("the deal agent's linked TC can waive an unpaid fee", async () => {
    const tc = await createUser({ role: "tc", auth0_id: "auth0|tc-linked" });
    const { deal } = await agentWithDeal(tc.id); // default fee_status 'unpaid'

    const res = await waive(deal.id, "auth0|tc-linked", ["tc"]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "waived" });
    await expect(feeStatus(deal.id)).resolves.toBe("waived");

    // Audit row attributed to the TC.
    const audit = await prisma.audit_log.findFirst({
      where: { event_type: "fee_waive", deal_id: deal.id },
    });
    expect(audit?.actor_id).toBe(tc.id);
  });

  it("an admin can waive an unpaid fee on any deal (global)", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const { deal } = await agentWithDeal();

    const res = await waive(deal.id, "auth0|admin", ["admin"]);
    expect(res.status).toBe(200);
    await expect(feeStatus(deal.id)).resolves.toBe("waived");
  });

  it("a linked TC can waive a 'pending' fee (checkout started, not paid)", async () => {
    const tc = await createUser({ role: "tc", auth0_id: "auth0|tc-linked" });
    const { deal } = await agentWithDeal(tc.id, "pending");

    const res = await waive(deal.id, "auth0|tc-linked", ["tc"]);
    expect(res.status).toBe(200);
    await expect(feeStatus(deal.id)).resolves.toBe("waived");
  });
});

describe("POST /api/deals/[id]/fee/waive — existing contract preserved", () => {
  it("404 for a nonexistent deal", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const res = await waive(randomUUID(), "auth0|admin", ["admin"]);
    expect(res.status).toBe(404);
  });

  it("401 without a token", async () => {
    const { deal } = await agentWithDeal();
    const res = await waiveRoute(
      new Request(`http://localhost/api/deals/${deal.id}/fee/waive`, {
        method: "POST",
      }),
      ctx(deal.id)
    );
    expect(res.status).toBe(401);
  });

  it("403 for roles outside admin/tc (agent cannot waive their own fee)", async () => {
    const { agent, deal } = await agentWithDeal();
    const res = await waive(deal.id, agent.auth0_id, ["agent"]);
    expect(res.status).toBe(403);
    await expect(feeStatus(deal.id)).resolves.toBe("unpaid");
  });
});
