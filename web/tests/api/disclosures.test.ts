import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { PATCH as disclosuresRoute } from "@/app/api/deals/[id]/disclosures/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser, createDeal } from "../helpers/factories";

// Disclosures are TRACKED, never sent from RTF: the lender delivers them
// out-of-band; RTF records completion. The old disclosure-packet SEND path is
// removed in this build (route + assembleDisclosurePacket + UI).

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

function patchReq(dealId: string, body: unknown, auth: string) {
  return new Request(`http://localhost/api/deals/${dealId}/disclosures`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: auth },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/deals/[id]/disclosures", () => {
  it("the owning agent marks disclosures complete (source=manual)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const res = await disclosuresRoute(
      patchReq(deal.id, { complete: true }, await authHeader("auth0|a", ["agent"])),
      ctx(deal.id)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { disclosures_complete: boolean };
    expect(body.disclosures_complete).toBe(true);

    const row = await prisma.deals.findUnique({ where: { id: deal.id } });
    expect(row?.disclosures_complete).toBe(true);
    expect(row?.disclosures_source).toBe("manual");
    expect(row?.disclosures_updated_at).not.toBeNull();
  });

  it("a TC can update any deal; toggling back off works", async () => {
    const agent = await createUser({ role: "agent" });
    await createUser({ role: "tc", auth0_id: "auth0|tc" });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deals.update({
      where: { id: deal.id },
      data: { disclosures_complete: true },
    });
    const res = await disclosuresRoute(
      patchReq(deal.id, { complete: false }, await authHeader("auth0|tc", ["tc"])),
      ctx(deal.id)
    );
    expect(res.status).toBe(200);
    const row = await prisma.deals.findUnique({ where: { id: deal.id } });
    expect(row?.disclosures_complete).toBe(false);
  });

  it("a non-owner agent gets 404; a buyer participant gets 403 via role gate", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|owner" });
    await createUser({ role: "agent", auth0_id: "auth0|other" });
    const buyer = await createUser({ role: "buyer", auth0_id: "auth0|buyer" });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });

    const other = await disclosuresRoute(
      patchReq(deal.id, { complete: true }, await authHeader("auth0|other", ["agent"])),
      ctx(deal.id)
    );
    expect(other.status).toBe(404);

    const asBuyer = await disclosuresRoute(
      patchReq(deal.id, { complete: true }, await authHeader("auth0|buyer", ["buyer"])),
      ctx(deal.id)
    );
    expect(asBuyer.status).toBe(404); // buyers never own deals; no TC/admin bypass
  });

  it("rejects a non-boolean body", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const res = await disclosuresRoute(
      patchReq(deal.id, { complete: "yes" }, await authHeader("auth0|a", ["agent"])),
      ctx(deal.id)
    );
    expect(res.status).toBe(400);
  });
});

describe("disclosure-packet send path removal", () => {
  it("the packet route module no longer exists", async () => {
    await expect(
      // @ts-expect-error — the module is intentionally deleted; this pins that.
      import("@/app/api/deals/[id]/disclosure-packet/route")
    ).rejects.toThrow();
  });
});
