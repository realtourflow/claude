import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  GET as listPropsRoute,
  POST as createPropRoute,
} from "@/app/api/deals/[id]/properties/route";
import {
  PATCH as patchPropRoute,
  DELETE as deletePropRoute,
} from "@/app/api/deals/[id]/properties/[propId]/route";
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
function propCtx(id: string, propId: string) {
  return { params: Promise.resolve({ id, propId }) };
}

async function seedProperty(dealId: string, auth0: string): Promise<{ id: string }> {
  const req = new Request(`http://localhost/api/deals/${dealId}/properties`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: await authHeader(auth0, ["agent"]),
    },
    body: JSON.stringify({ address: "123 Test St" }),
  });
  const res = await createPropRoute(req, dealCtx(dealId));
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

async function patchProp(
  dealId: string,
  propId: string,
  auth0: string,
  body: object
): Promise<Response> {
  const req = new Request(
    `http://localhost/api/deals/${dealId}/properties/${propId}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader(auth0, ["agent"]),
      },
      body: JSON.stringify(body),
    }
  );
  return patchPropRoute(req, propCtx(dealId, propId));
}

describe("GET /api/deals/[id]/properties — agent_private_note privacy", () => {
  const PRIVATE_NOTE = "seller is desperate, lowball them";

  async function seedDealWithPrivateNote() {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const buyer = await createUser({ role: "buyer", auth0_id: "auth0|buyer" });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });
    const prop = await seedProperty(deal.id, "auth0|agent");
    await prisma.tracked_properties.update({
      where: { id: prop.id },
      data: {
        agent_private_note: PRIVATE_NOTE,
        agent_note: "shared agent note",
        buyer_note: "buyer's own note",
        status: "toured",
      },
    });
    return { agent, buyer, deal, prop };
  }

  async function listProps(
    dealId: string,
    auth0: string,
    roles: string[]
  ): Promise<Response> {
    const req = new Request(`http://localhost/api/deals/${dealId}/properties`, {
      headers: { authorization: await authHeader(auth0, roles) },
    });
    return listPropsRoute(req, dealCtx(dealId));
  }

  it("never sends agent_private_note to a buyer participant", async () => {
    const { deal } = await seedDealWithPrivateNote();

    const res = await listProps(deal.id, "auth0|buyer", ["buyer"]);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    // The key must be absent from the wire payload entirely, not just null.
    expect("agent_private_note" in rows[0]).toBe(false);
    expect(JSON.stringify(rows)).not.toContain(PRIVATE_NOTE);
  });

  it("still returns agent_private_note to the owning agent", async () => {
    const { deal } = await seedDealWithPrivateNote();

    const res = await listProps(deal.id, "auth0|agent", ["agent"]);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].agent_private_note).toBe(PRIVATE_NOTE);
  });

  it("leaves all buyer-visible fields intact for the buyer", async () => {
    const { deal, prop } = await seedDealWithPrivateNote();

    const res = await listProps(deal.id, "auth0|buyer", ["buyer"]);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Record<string, unknown>[];
    const row = rows[0];

    expect(row.id).toBe(prop.id);
    expect(row.deal_id).toBe(deal.id);
    expect(row.address).toBe("123 Test St");
    expect(row.status).toBe("toured");
    expect(row.agent_note).toBe("shared agent note");
    expect(row.buyer_note).toBe("buyer's own note");
    expect(row.offer_requested).toBe(false);
    for (const key of [
      "city",
      "state",
      "price",
      "beds",
      "baths",
      "sqft",
      "thumbnail_url",
      "source_url",
      "added_by",
      "created_at",
      "updated_at",
    ]) {
      expect(row).toHaveProperty(key);
    }
  });
});

describe("PATCH /api/deals/[id]/properties/[propId]", () => {
  it("persists status, buyer_note, agent_private_note, and offer_requested", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const prop = await seedProperty(deal.id, "auth0|a");

    for (const body of [
      { status: "touring" },
      { buyer_note: "love the kitchen" },
      { agent_private_note: "overpriced by 20k" },
      { offer_requested: true },
    ]) {
      const res = await patchProp(deal.id, prop.id, "auth0|a", body);
      expect(res.status).toBe(200);
    }

    const row = await prisma.tracked_properties.findUnique({
      where: { id: prop.id },
    });
    expect(row?.status).toBe("touring");
    expect(row?.buyer_note).toBe("love the kitchen");
    expect(row?.agent_private_note).toBe("overpriced by 20k");
    expect(row?.offer_requested).toBe(true);
  });

  it("404s (and persists nothing) for an agent who doesn't own the deal", async () => {
    const owner = await createUser({ role: "agent", auth0_id: "auth0|owner" });
    const deal = await createDeal({ agent_id: owner.id });
    const prop = await seedProperty(deal.id, "auth0|owner");
    await createUser({ role: "agent", auth0_id: "auth0|other" });

    const res = await patchProp(deal.id, prop.id, "auth0|other", {
      status: "touring",
    });
    expect(res.status).toBe(404);

    const row = await prisma.tracked_properties.findUnique({
      where: { id: prop.id },
    });
    expect(row?.status).toBe("interested"); // default, unchanged
  });
});

describe("DELETE /api/deals/[id]/properties/[propId]", () => {
  it("removes the property for the owning agent", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const prop = await seedProperty(deal.id, "auth0|a");

    const req = new Request(
      `http://localhost/api/deals/${deal.id}/properties/${prop.id}`,
      {
        method: "DELETE",
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }
    );
    const res = await deletePropRoute(req, propCtx(deal.id, prop.id));
    expect(res.status).toBe(204);

    const row = await prisma.tracked_properties.findUnique({
      where: { id: prop.id },
    });
    expect(row).toBeNull();
  });
});
