import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { POST as createPropRoute } from "@/app/api/deals/[id]/properties/route";
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
