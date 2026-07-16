import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { GET as listDealVendorsRoute } from "@/app/api/deals/[id]/vendors/route";
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

function dealCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

type ApiVendor = {
  id: string;
  agent_id: string;
  category: string;
  company: string;
  contact_name: string;
  phone: string;
  email: string;
  website: string;
  notes: string;
  is_featured: boolean;
  sort_order: number;
  created_at: string;
};

async function seedVendor(
  agentId: string,
  category: string,
  company: string,
  sortOrder: number
): Promise<void> {
  await prisma.preferred_vendors.create({
    data: { agent_id: agentId, category, company, sort_order: sortOrder },
  });
}

async function listDealVendors(
  dealId: string,
  auth0: string,
  roles: string[]
): Promise<Response> {
  const req = new Request(`http://localhost/api/deals/${dealId}/vendors`, {
    headers: { authorization: await authHeader(auth0, roles) },
  });
  return listDealVendorsRoute(req, dealCtx(dealId));
}

describe("GET /api/deals/[id]/vendors", () => {
  // Case 1 — the portal bug: a participant (buyer) must see the DEAL AGENT's
  // vendors, not their own (always-empty) list. Ordered category asc, sort asc.
  it("returns the owning agent's vendors to a deal participant", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const buyer = await createUser({ role: "buyer", auth0_id: "auth0|buyer" });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });

    // Insert out of order; expect category asc, then sort_order asc.
    await seedVendor(agent.id, "lender", "Lender A", 0);
    await seedVendor(agent.id, "lender", "Lender B", 1);
    await seedVendor(agent.id, "inspector", "Inspector A", 0);

    const res = await listDealVendors(deal.id, "auth0|buyer", ["buyer"]);
    expect(res.status).toBe(200);
    const list = (await res.json()) as ApiVendor[];
    expect(
      list.map((v) => `${v.category}/${v.company}/${v.sort_order}`)
    ).toEqual(["inspector/Inspector A/0", "lender/Lender A/0", "lender/Lender B/1"]);
    // Every vendor belongs to the deal's agent, not the calling buyer.
    expect(list.every((v) => v.agent_id === agent.id)).toBe(true);
  });

  // Case 1b — the owning agent may also read their own vendors via this route.
  it("returns the owning agent's vendors to the owning agent", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const deal = await createDeal({ agent_id: agent.id });
    await seedVendor(agent.id, "lender", "Lender A", 0);

    const res = await listDealVendors(deal.id, "auth0|agent", ["agent"]);
    expect(res.status).toBe(200);
    const list = (await res.json()) as ApiVendor[];
    expect(list).toHaveLength(1);
    expect(list[0].company).toBe("Lender A");
  });

  // Case 2 — no deal access → 404, and no vendor data leaks in the body.
  it("404s for a user with no access to the deal (no vendor-list leak)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent" });
    await createUser({ role: "buyer", auth0_id: "auth0|stranger" });
    const deal = await createDeal({ agent_id: agent.id });
    await seedVendor(agent.id, "lender", "Secret Lender", 0);

    const res = await listDealVendors(deal.id, "auth0|stranger", ["buyer"]);
    expect(res.status).toBe(404);
    const bodyText = await res.text();
    expect(bodyText).not.toContain("Secret Lender");
  });

  // Case 3 — agent has no vendors → 200 with []. Component keeps self-hiding.
  it("returns 200 with [] when the owning agent has no vendors", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const seller = await createUser({ role: "seller", auth0_id: "auth0|seller" });
    const deal = await createDeal({ agent_id: agent.id, type: "sell" });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: seller.id, role: "seller" },
    });

    const res = await listDealVendors(deal.id, "auth0|seller", ["seller"]);
    expect(res.status).toBe(200);
    const list = (await res.json()) as ApiVendor[];
    expect(list).toEqual([]);
  });
});
