import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  GET as listPropsRoute,
  POST as createPropRoute,
} from "@/app/api/deals/[id]/properties/route";
import {
  PATCH as patchPropRoute,
  DELETE as deletePropRoute,
} from "@/app/api/deals/[id]/properties/[propId]/route";
import {
  GET as listOffersRoute,
  POST as createOfferRoute,
} from "@/app/api/deals/[id]/offers/route";
import { DELETE as deleteOfferRoute } from "@/app/api/offers/[id]/route";
import {
  GET as getNetSheetRoute,
  PUT as putNetSheetRoute,
} from "@/app/api/deals/[id]/net-sheet/route";
import { POST as readyNetSheetRoute } from "@/app/api/deals/[id]/net-sheet/ready/route";
import {
  GET as getShowingRoute,
  PUT as putShowingRoute,
} from "@/app/api/deals/[id]/showing-availability/route";
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

function ctx<T extends Record<string, string>>(p: T) {
  return { params: Promise.resolve(p) };
}

describe("Tracked properties", () => {
  it("create + list + patch status + delete", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });

    // Create
    const createReq = new Request(
      `http://localhost/api/deals/${deal.id}/properties`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        body: JSON.stringify({
          address: "123 Elm St",
          city: "Springfield",
          state: "IL",
          price: 350000,
        }),
      }
    );
    const createRes = await createPropRoute(createReq, ctx({ id: deal.id }));
    expect(createRes.status).toBe(201);
    const p = (await createRes.json()) as { id: string; address: string };
    expect(p.address).toBe("123 Elm St");

    // List
    const listReq = new Request(
      `http://localhost/api/deals/${deal.id}/properties`,
      { headers: { authorization: await authHeader("auth0|a", ["agent"]) } }
    );
    const listRes = await listPropsRoute(listReq, ctx({ id: deal.id }));
    expect(((await listRes.json()) as unknown[]).length).toBe(1);

    // Patch status
    const patchReq = new Request(
      `http://localhost/api/deals/${deal.id}/properties/${p.id}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        body: JSON.stringify({ status: "favorite" }),
      }
    );
    const patchRes = await patchPropRoute(
      patchReq,
      ctx({ id: deal.id, propId: p.id })
    );
    expect(patchRes.status).toBe(200);

    // Delete
    const delReq = new Request(
      `http://localhost/api/deals/${deal.id}/properties/${p.id}`,
      {
        method: "DELETE",
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }
    );
    const delRes = await deletePropRoute(
      delReq,
      ctx({ id: deal.id, propId: p.id })
    );
    expect(delRes.status).toBe(204);
  });

  it("400 when address missing on create", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const req = new Request(
      `http://localhost/api/deals/${deal.id}/properties`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        body: JSON.stringify({ price: 1 }),
      }
    );
    const res = await createPropRoute(req, ctx({ id: deal.id }));
    expect(res.status).toBe(400);
  });
});

describe("Offers", () => {
  it("create + list + delete", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });

    const createReq = new Request(
      `http://localhost/api/deals/${deal.id}/offers`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        body: JSON.stringify({
          buyer_name: "Jane Doe",
          offer_price: 425000,
          contingencies: ["financing", "inspection"],
          close_date: "2026-06-15",
        }),
      }
    );
    const createRes = await createOfferRoute(createReq, ctx({ id: deal.id }));
    expect(createRes.status).toBe(201);
    const o = (await createRes.json()) as { id: string };

    const listRes = await listOffersRoute(
      new Request(`http://localhost/api/deals/${deal.id}/offers`, {
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }),
      ctx({ id: deal.id })
    );
    const list = (await listRes.json()) as unknown[];
    expect(list.length).toBe(1);

    const delRes = await deleteOfferRoute(
      new Request(`http://localhost/api/offers/${o.id}`, {
        method: "DELETE",
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }),
      ctx({ id: o.id })
    );
    expect(delRes.status).toBe(204);
  });

  it("non-owner cannot delete", async () => {
    const agent = await createUser({ role: "agent" });
    const stranger = await createUser({ role: "agent", auth0_id: "auth0|s" });
    const deal = await createDeal({ agent_id: agent.id });
    const offer = await prisma.offers.create({ data: { deal_id: deal.id } });
    void stranger;
    const res = await deleteOfferRoute(
      new Request(`http://localhost/api/offers/${offer.id}`, {
        method: "DELETE",
        headers: { authorization: await authHeader("auth0|s", ["agent"]) },
      }),
      ctx({ id: offer.id })
    );
    expect(res.status).toBe(404);
  });
});

describe("Net sheet", () => {
  it("GET auto-creates a seeded net sheet; PUT updates; POST ready marks ready", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });

    const getRes = await getNetSheetRoute(
      new Request(`http://localhost/api/deals/${deal.id}/net-sheet`, {
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }),
      ctx({ id: deal.id })
    );
    // 201: auto-created, seeded with the default deduction lines (#181).
    expect(getRes.status).toBe(201);
    const initial = (await getRes.json()) as {
      sale_price: number;
      status: string;
      lines: unknown[];
    };
    expect(initial.sale_price).toBe(0); // factory deal has no price set
    expect(initial.status).toBe("draft");
    expect(initial.lines.length).toBeGreaterThan(0);

    const putRes = await putNetSheetRoute(
      new Request(`http://localhost/api/deals/${deal.id}/net-sheet`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        body: JSON.stringify({
          sale_price: 500000,
          annual_taxes: 8000,
          closing_date: "2026-08-01",
        }),
      }),
      ctx({ id: deal.id })
    );
    expect(putRes.status).toBe(200);

    const readyRes = await readyNetSheetRoute(
      new Request(`http://localhost/api/deals/${deal.id}/net-sheet/ready`, {
        method: "POST",
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }),
      ctx({ id: deal.id })
    );
    expect(readyRes.status).toBe(200);
    const ready = (await readyRes.json()) as {
      status: string;
      ready_at: string | null;
    };
    expect(ready.status).toBe("ready");
    expect(ready.ready_at).not.toBeNull();
  });
});

describe("Showing availability", () => {
  it("PUT stores JSONB; GET returns it", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const data = {
      monday: ["09:00-17:00"],
      tuesday: ["09:00-17:00"],
    };
    const putRes = await putShowingRoute(
      new Request(
        `http://localhost/api/deals/${deal.id}/showing-availability`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            authorization: await authHeader("auth0|a", ["agent"]),
          },
          body: JSON.stringify(data),
        }
      ),
      ctx({ id: deal.id })
    );
    expect(putRes.status).toBe(200);

    const getRes = await getShowingRoute(
      new Request(
        `http://localhost/api/deals/${deal.id}/showing-availability`,
        { headers: { authorization: await authHeader("auth0|a", ["agent"]) } }
      ),
      ctx({ id: deal.id })
    );
    const body = await getRes.json();
    expect(body).toEqual(data);
  });
});
