import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  GET as getLinkRoute,
  POST as createLinkRoute,
  DELETE as deleteLinkRoute,
} from "@/app/api/deals/[id]/link/route";
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

async function postLink(
  dealId: string,
  counterpartDealId: string,
  auth0: string,
  roles: string[] = ["agent"]
): Promise<Response> {
  const req = new Request(`http://localhost/api/deals/${dealId}/link`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: await authHeader(auth0, roles),
    },
    body: JSON.stringify({ counterpart_deal_id: counterpartDealId }),
  });
  return createLinkRoute(req, dealCtx(dealId));
}

async function getLink(
  dealId: string,
  auth0: string,
  roles: string[] = ["agent"]
): Promise<Response> {
  const req = new Request(`http://localhost/api/deals/${dealId}/link`, {
    headers: { authorization: await authHeader(auth0, roles) },
  });
  return getLinkRoute(req, dealCtx(dealId));
}

async function deleteLink(
  dealId: string,
  auth0: string,
  roles: string[] = ["agent"]
): Promise<Response> {
  const req = new Request(`http://localhost/api/deals/${dealId}/link`, {
    method: "DELETE",
    headers: { authorization: await authHeader(auth0, roles) },
  });
  return deleteLinkRoute(req, dealCtx(dealId));
}

/** One agent owning a buy deal + a sell deal — the happy-path bridge pair. */
async function seedBridgePair() {
  const agent = await createUser({ role: "agent", auth0_id: "auth0|agentA" });
  const buyDeal = await createDeal({
    agent_id: agent.id,
    type: "buy",
    title: "Buy 123 New St",
  });
  const sellDeal = await createDeal({
    agent_id: agent.id,
    type: "sell",
    title: "Sell 9 Old Rd",
  });
  return { agent, buyDeal, sellDeal };
}

describe("POST /api/deals/[id]/link — create bridge link", () => {
  it("links the agent's buy deal to their sell deal (201, correct orientation)", async () => {
    const { buyDeal, sellDeal } = await seedBridgePair();

    const res = await postLink(buyDeal.id, sellDeal.id, "auth0|agentA");
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.buy_deal_id).toBe(buyDeal.id);
    expect(body.sell_deal_id).toBe(sellDeal.id);
    expect(body.this_side).toBe("buy");
    const counterpart = body.counterpart as Record<string, unknown>;
    expect(counterpart.id).toBe(sellDeal.id);
    expect(counterpart.type).toBe("sell");

    const row = await prisma.deal_links.findFirst();
    expect(row?.buy_deal_id).toBe(buyDeal.id);
    expect(row?.sell_deal_id).toBe(sellDeal.id);
  });

  it("is order-independent — posting from the sell side still stores buy/sell correctly", async () => {
    const { buyDeal, sellDeal } = await seedBridgePair();

    // URL deal is the SELL deal; counterpart is the BUY deal.
    const res = await postLink(sellDeal.id, buyDeal.id, "auth0|agentA");
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.buy_deal_id).toBe(buyDeal.id);
    expect(body.sell_deal_id).toBe(sellDeal.id);
    expect(body.this_side).toBe("sell");

    const row = await prisma.deal_links.findFirst();
    expect(row?.buy_deal_id).toBe(buyDeal.id);
    expect(row?.sell_deal_id).toBe(sellDeal.id);
  });

  it("400s when counterpart_deal_id is missing", async () => {
    const { buyDeal } = await seedBridgePair();
    const req = new Request(`http://localhost/api/deals/${buyDeal.id}/link`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|agentA", ["agent"]),
      },
      body: JSON.stringify({}),
    });
    const res = await createLinkRoute(req, dealCtx(buyDeal.id));
    expect(res.status).toBe(400);
    expect(await prisma.deal_links.count()).toBe(0);
  });

  it("400s when counterpart_deal_id is not a uuid (rather than 500ing in Postgres)", async () => {
    const { buyDeal } = await seedBridgePair();
    const res = await postLink(buyDeal.id, "not-a-uuid", "auth0|agentA");
    expect(res.status).toBe(400);
    expect(await prisma.deal_links.count()).toBe(0);
  });

  it("404s when the URL deal id is not a uuid", async () => {
    await seedBridgePair();
    const res = await postLink(
      "garbage-id",
      "11111111-1111-4111-8111-111111111111",
      "auth0|agentA"
    );
    expect(res.status).toBe(404);
  });

  it("400s when linking a deal to itself", async () => {
    const { buyDeal } = await seedBridgePair();
    const res = await postLink(buyDeal.id, buyDeal.id, "auth0|agentA");
    expect(res.status).toBe(400);
    expect(await prisma.deal_links.count()).toBe(0);
  });

  it("400s when both deals are the same type (not one buy + one sell)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agentA" });
    const buy1 = await createDeal({ agent_id: agent.id, type: "buy" });
    const buy2 = await createDeal({ agent_id: agent.id, type: "buy" });

    const res = await postLink(buy1.id, buy2.id, "auth0|agentA");
    expect(res.status).toBe(400);
    expect(await prisma.deal_links.count()).toBe(0);
  });

  it("404s when the caller does not own the counterpart deal", async () => {
    const { buyDeal } = await seedBridgePair();
    const other = await createUser({ role: "agent", auth0_id: "auth0|agentB" });
    const otherSell = await createDeal({ agent_id: other.id, type: "sell" });

    const res = await postLink(buyDeal.id, otherSell.id, "auth0|agentA");
    expect(res.status).toBe(404);
    expect(await prisma.deal_links.count()).toBe(0);
  });

  it("404s when the caller does not own the URL deal", async () => {
    const { sellDeal } = await seedBridgePair(); // owned by agentA
    const other = await createUser({ role: "agent", auth0_id: "auth0|agentB" });
    const otherBuy = await createDeal({ agent_id: other.id, type: "buy" });

    // agentB posts from their own buy deal toward agentA's sell deal.
    const res = await postLink(otherBuy.id, sellDeal.id, "auth0|agentB");
    expect(res.status).toBe(404);
    expect(await prisma.deal_links.count()).toBe(0);
  });

  it("409s when the URL deal is already bridge-linked", async () => {
    const { agent, buyDeal, sellDeal } = await seedBridgePair();
    const sellDeal2 = await createDeal({ agent_id: agent.id, type: "sell" });

    expect((await postLink(buyDeal.id, sellDeal.id, "auth0|agentA")).status).toBe(201);
    const res = await postLink(buyDeal.id, sellDeal2.id, "auth0|agentA");
    expect(res.status).toBe(409);
    expect(await prisma.deal_links.count()).toBe(1);
  });

  it("409s when the counterpart deal is already bridge-linked", async () => {
    const { agent, buyDeal, sellDeal } = await seedBridgePair();
    const buyDeal2 = await createDeal({ agent_id: agent.id, type: "buy" });

    expect((await postLink(buyDeal.id, sellDeal.id, "auth0|agentA")).status).toBe(201);
    // sellDeal is taken; try to attach a fresh buy deal to it.
    const res = await postLink(buyDeal2.id, sellDeal.id, "auth0|agentA");
    expect(res.status).toBe(409);
    expect(await prisma.deal_links.count()).toBe(1);
  });
});

describe("GET /api/deals/[id]/link — read bridge link", () => {
  it("returns { link: null } when the deal has no bridge", async () => {
    const { buyDeal } = await seedBridgePair();
    const res = await getLink(buyDeal.id, "auth0|agentA");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { link: unknown };
    expect(body.link).toBeNull();
  });

  it("returns the link + counterpart summary for the owning agent", async () => {
    const { buyDeal, sellDeal } = await seedBridgePair();
    await postLink(buyDeal.id, sellDeal.id, "auth0|agentA");

    const res = await getLink(buyDeal.id, "auth0|agentA");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { link: Record<string, unknown> };
    expect(body.link.this_side).toBe("buy");
    const counterpart = body.link.counterpart as Record<string, unknown>;
    expect(counterpart.id).toBe(sellDeal.id);
    expect(counterpart.type).toBe("sell");
  });

  it("lets a buyer participant read the link, but HIDES the counterpart summary", async () => {
    const { buyDeal, sellDeal } = await seedBridgePair();
    const buyer = await createUser({ role: "buyer", auth0_id: "auth0|buyerP" });
    // Participant on the BUY leg only — no access to the sell deal.
    await prisma.deal_participants.create({
      data: { deal_id: buyDeal.id, user_id: buyer.id, role: "buyer" },
    });
    await postLink(buyDeal.id, sellDeal.id, "auth0|agentA");

    const res = await getLink(buyDeal.id, "auth0|buyerP", ["buyer"]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { link: Record<string, unknown> | null };
    expect(body.link).not.toBeNull();
    const link = body.link as Record<string, unknown>;
    expect(link.sell_deal_id).toBe(sellDeal.id);
    // The other transaction's title/address must not leak to someone who is
    // not on that deal (same-client is not enforced).
    expect(link.counterpart).toBeNull();
    expect(JSON.stringify(body)).not.toContain("Sell 9 Old Rd");
  });

  it("includes the counterpart summary for a participant on BOTH legs", async () => {
    const { buyDeal, sellDeal } = await seedBridgePair();
    const client = await createUser({ role: "buyer", auth0_id: "auth0|bothP" });
    // The real bridge case: one client buying and selling.
    await prisma.deal_participants.create({
      data: { deal_id: buyDeal.id, user_id: client.id, role: "buyer" },
    });
    await prisma.deal_participants.create({
      data: { deal_id: sellDeal.id, user_id: client.id, role: "seller" },
    });
    await postLink(buyDeal.id, sellDeal.id, "auth0|agentA");

    const res = await getLink(buyDeal.id, "auth0|bothP", ["buyer"]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { link: Record<string, unknown> };
    const counterpart = body.link.counterpart as Record<string, unknown>;
    expect(counterpart.id).toBe(sellDeal.id);
    expect(counterpart.title).toBe("Sell 9 Old Rd");
  });

  it("404s on a malformed deal id instead of 500ing", async () => {
    await seedBridgePair();
    const res = await getLink("not-a-uuid", "auth0|agentA");
    expect(res.status).toBe(404);
  });

  it("404s for a stranger with no access to the deal", async () => {
    const { buyDeal, sellDeal } = await seedBridgePair();
    await createUser({ role: "buyer", auth0_id: "auth0|stranger" });
    await postLink(buyDeal.id, sellDeal.id, "auth0|agentA");

    const res = await getLink(buyDeal.id, "auth0|stranger", ["buyer"]);
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/deals/[id]/link — remove bridge link", () => {
  it("removes the link for the owning agent (204) and GET then returns null", async () => {
    const { buyDeal, sellDeal } = await seedBridgePair();
    await postLink(buyDeal.id, sellDeal.id, "auth0|agentA");

    const res = await deleteLink(buyDeal.id, "auth0|agentA");
    expect(res.status).toBe(204);
    expect(await prisma.deal_links.count()).toBe(0);

    const after = await getLink(sellDeal.id, "auth0|agentA");
    expect(((await after.json()) as { link: unknown }).link).toBeNull();
  });

  it("is idempotent — deleting when there is no link still 204s", async () => {
    const { buyDeal } = await seedBridgePair();
    const res = await deleteLink(buyDeal.id, "auth0|agentA");
    expect(res.status).toBe(204);
  });

  it("404s for an agent who does not own the deal (and leaves the link intact)", async () => {
    const { buyDeal, sellDeal } = await seedBridgePair();
    await createUser({ role: "agent", auth0_id: "auth0|agentB" });
    await postLink(buyDeal.id, sellDeal.id, "auth0|agentA");

    const res = await deleteLink(buyDeal.id, "auth0|agentB");
    expect(res.status).toBe(404);
    expect(await prisma.deal_links.count()).toBe(1);
  });
});
