import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import type Stripe from "stripe";
import { POST as fastPassRoute } from "@/app/api/deals/[id]/fastpass/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setStripeForTesting } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser, createDeal } from "../helpers/factories";

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
});

afterEach(() => {
  setStripeForTesting(undefined);
});

afterAll(() => {
  setStripeForTesting(undefined);
});

beforeEach(async () => {
  await truncateAll();
});

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

// Base 297700 + utility_setup 9700 + staging_consult 24700 = 332100.
const EXPECTED_TOTAL = 332100;

describe("POST /api/deals/[id]/fastpass", () => {
  it("owner enrolls deferred (at_closing) → 200 {ok:true}, enrollment persisted with server total + deduped upsells", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id, title: "123 Main St" });

    const r = new Request(`http://localhost/api/deals/${deal.id}/fastpass`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({
        payment_option: "at_closing",
        // Duplicate staging_consult proves dedupe; client total is ignored.
        selected_upsells: ["utility_setup", "staging_consult", "staging_consult"],
        total_cents: 999,
        survey_answers: { currentSituation: "renting", targetMoveDate: "2026-08-01" },
      }),
    });
    const res = await fastPassRoute(r, ctx(deal.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean; checkout_url?: string };
    expect(json.ok).toBe(true);
    expect(json.checkout_url).toBeUndefined();

    // Read back the JSONB via raw SQL to confirm the persisted shape.
    const rows = await prisma.$queryRaw<
      {
        status: string;
        payment_option: string;
        total_cents: string;
        paid: boolean;
        survey_situation: string;
        selected_upsells: unknown;
        enrolled_at: string | null;
      }[]
    >`
      SELECT fast_pass->>'status'                          AS status,
             fast_pass->>'payment_option'                  AS payment_option,
             fast_pass->>'total_cents'                     AS total_cents,
             (fast_pass->>'paid')::boolean                 AS paid,
             fast_pass->'survey_answers'->>'currentSituation' AS survey_situation,
             fast_pass->'selected_upsells'                 AS selected_upsells,
             fast_pass->>'enrolled_at'                     AS enrolled_at
      FROM deals WHERE id = ${deal.id}::uuid
    `;
    const row = rows[0];
    expect(row.status).toBe("active");
    expect(row.payment_option).toBe("at_closing");
    expect(row.total_cents).toBe(String(EXPECTED_TOTAL));
    expect(row.paid).toBe(false);
    expect(row.survey_situation).toBe("renting");
    // Deduped — staging_consult appears once.
    expect(row.selected_upsells).toEqual(["utility_setup", "staging_consult"]);
    expect(row.enrolled_at).toBeTruthy();
  });

  it("payment_option 'now' → 200 {checkout_url}; tampered total_cents ignored, Stripe gets catalog amount + fast_pass metadata", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id, title: "456 Oak Ave" });

    let captured: Stripe.Checkout.SessionCreateParams | undefined;
    setStripeForTesting({
      checkout: {
        sessions: {
          create: async (params: Stripe.Checkout.SessionCreateParams) => {
            captured = params;
            return {
              id: "cs_fastpass_1",
              url: "https://stripe.test/checkout/cs_fastpass_1",
            };
          },
        },
      },
      webhooks: {
        constructEvent: () => {
          throw new Error("not used");
        },
      },
    });

    const r = new Request(`http://localhost/api/deals/${deal.id}/fastpass`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({
        payment_option: "now",
        selected_upsells: ["utility_setup", "staging_consult"],
        // Hostile client claims the whole thing costs 1 cent.
        total_cents: 1,
        survey_answers: { currentSituation: "selling" },
      }),
    });
    const res = await fastPassRoute(r, ctx(deal.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean; checkout_url?: string };
    expect(json.ok).toBe(true);
    expect(json.checkout_url).toBe("https://stripe.test/checkout/cs_fastpass_1");

    // Stripe received the catalog amount (base + upsells), product, metadata.
    expect(captured).toBeDefined();
    const lineItem = captured!.line_items?.[0];
    expect(lineItem?.price_data?.unit_amount).toBe(EXPECTED_TOTAL);
    expect(lineItem?.price_data?.product_data?.name).toBe("Fast Pass Concierge Service");
    expect(lineItem?.price_data?.product_data?.description).toBe(
      "Fast Pass enrollment for 456 Oak Ave"
    );
    expect(captured!.mode).toBe("payment");
    expect(captured!.metadata).toMatchObject({
      deal_id: deal.id,
      type: "fast_pass",
    });

    // The JSONB stores the SERVER-computed total, not the client's 1 cent.
    const rows = await prisma.$queryRaw<
      { status: string; paid: boolean; total_cents: string }[]
    >`
      SELECT fast_pass->>'status' AS status,
             (fast_pass->>'paid')::boolean AS paid,
             fast_pass->>'total_cents' AS total_cents
      FROM deals WHERE id = ${deal.id}::uuid
    `;
    expect(rows[0].status).toBe("active");
    expect(rows[0].paid).toBe(false);
    expect(rows[0].total_cents).toBe(String(EXPECTED_TOTAL));
  });

  it("invalid payment_option → 400, nothing persisted", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });

    const r = new Request(`http://localhost/api/deals/${deal.id}/fastpass`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({
        payment_option: "later",
        selected_upsells: [],
      }),
    });
    const res = await fastPassRoute(r, ctx(deal.id));
    expect(res.status).toBe(400);

    const row = await prisma.deals.findUnique({ where: { id: deal.id } });
    expect(row?.fast_pass).toBeNull();
  });

  it("unknown upsell key → 400, no Stripe call, existing enrollment untouched", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    // Seed a prior enrollment so we can prove the bad request doesn't clobber it.
    await prisma.deals.update({
      where: { id: deal.id },
      data: {
        fast_pass: {
          status: "active",
          payment_option: "at_closing",
          selected_upsells: [],
          total_cents: 297700,
          paid: false,
          enrolled_at: "2026-01-01T00:00:00.000Z",
        },
      },
    });

    let stripeCalled = false;
    setStripeForTesting({
      checkout: {
        sessions: {
          create: async () => {
            stripeCalled = true;
            return { id: "cs_nope", url: "https://stripe.test/nope" };
          },
        },
      },
      webhooks: {
        constructEvent: () => {
          throw new Error("not used");
        },
      },
    });

    const r = new Request(`http://localhost/api/deals/${deal.id}/fastpass`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({
        payment_option: "now",
        selected_upsells: ["staging_consult", "free_money"],
        total_cents: 1,
      }),
    });
    const res = await fastPassRoute(r, ctx(deal.id));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("free_money");
    expect(stripeCalled).toBe(false);

    // Validation happens BEFORE persisting — the seeded enrollment survives.
    const rows = await prisma.$queryRaw<
      { payment_option: string; enrolled_at: string }[]
    >`
      SELECT fast_pass->>'payment_option' AS payment_option,
             fast_pass->>'enrolled_at'    AS enrolled_at
      FROM deals WHERE id = ${deal.id}::uuid
    `;
    expect(rows[0].payment_option).toBe("at_closing");
    expect(rows[0].enrolled_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("403 when caller is not the deal owner", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|owner" });
    await createUser({ role: "agent", auth0_id: "auth0|other" });
    const deal = await createDeal({ agent_id: agent.id });

    const r = new Request(`http://localhost/api/deals/${deal.id}/fastpass`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|other", ["agent"]),
      },
      body: JSON.stringify({ payment_option: "at_closing", selected_upsells: [] }),
    });
    const res = await fastPassRoute(r, ctx(deal.id));
    expect(res.status).toBe(403);

    const row = await prisma.deals.findUnique({ where: { id: deal.id } });
    expect(row?.fast_pass).toBeNull();
  });

  it("404 when the deal does not exist", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const missingId = "00000000-0000-0000-0000-000000000000";

    const r = new Request(`http://localhost/api/deals/${missingId}/fastpass`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ payment_option: "at_closing", selected_upsells: [] }),
    });
    const res = await fastPassRoute(r, ctx(missingId));
    expect(res.status).toBe(404);
  });
});
