import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import type Stripe from "stripe";
import { POST as smoothExitRoute } from "@/app/api/deals/[id]/smoothexit/route";
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

describe("POST /api/deals/[id]/smoothexit", () => {
  it("owner enrolls with no upsells → 200 {ok:true}, enrollment persisted active", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id, title: "123 Main St" });

    const r = new Request(`http://localhost/api/deals/${deal.id}/smoothexit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({
        payment_option: "from_proceeds",
        estimated_sale_price: 450000,
        fee_cents: 450000,
        survey_answers: { goal: "upsize", timeline: "asap" },
        selected_upsells: [],
        upsell_total_cents: 0,
      }),
    });
    const res = await smoothExitRoute(r, ctx(deal.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean; checkout_url?: string };
    expect(json.ok).toBe(true);
    expect(json.checkout_url).toBeUndefined();

    // Read back the JSONB via raw SQL to confirm the persisted shape.
    const rows = await prisma.$queryRaw<
      {
        status: string;
        payment_option: string;
        estimated_sale_price: string;
        fee_cents: string;
        upsell_total_cents: string;
        upsells_paid: boolean;
        survey_goal: string;
        selected_upsells: unknown;
        enrolled_at: string | null;
      }[]
    >`
      SELECT smooth_exit->>'status'                       AS status,
             smooth_exit->>'payment_option'               AS payment_option,
             smooth_exit->>'estimated_sale_price'         AS estimated_sale_price,
             smooth_exit->>'fee_cents'                    AS fee_cents,
             smooth_exit->>'upsell_total_cents'           AS upsell_total_cents,
             (smooth_exit->>'upsells_paid')::boolean      AS upsells_paid,
             smooth_exit->'survey_answers'->>'goal'       AS survey_goal,
             smooth_exit->'selected_upsells'              AS selected_upsells,
             smooth_exit->>'enrolled_at'                  AS enrolled_at
      FROM deals WHERE id = ${deal.id}::uuid
    `;
    const row = rows[0];
    expect(row.status).toBe("active");
    expect(row.payment_option).toBe("from_proceeds");
    expect(row.estimated_sale_price).toBe("450000");
    expect(row.fee_cents).toBe("450000");
    expect(row.upsell_total_cents).toBe("0");
    expect(row.upsells_paid).toBe(false);
    expect(row.survey_goal).toBe("upsize");
    expect(row.selected_upsells).toEqual([]);
    expect(row.enrolled_at).toBeTruthy();
  });

  it("owner enrolls WITH upsells → 200 {ok:true, checkout_url}; Stripe gets right amount + metadata", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id, title: "456 Oak Ave" });

    let captured: Stripe.Checkout.SessionCreateParams | undefined;
    setStripeForTesting({
      checkout: {
        sessions: {
          create: async (params: Stripe.Checkout.SessionCreateParams) => {
            captured = params;
            return {
              id: "cs_smoothexit_1",
              url: "https://stripe.test/checkout/cs_smoothexit_1",
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

    const r = new Request(`http://localhost/api/deals/${deal.id}/smoothexit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({
        payment_option: "buyer_concession",
        estimated_sale_price: 600000,
        fee_cents: 600000,
        survey_answers: { goal: "downsize" },
        // staging_consult (24700) + photography_upgrade (19700) = 44400
        selected_upsells: ["staging_consult", "photography_upgrade"],
        upsell_total_cents: 44400,
      }),
    });
    const res = await smoothExitRoute(r, ctx(deal.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean; checkout_url?: string };
    expect(json.ok).toBe(true);
    expect(json.checkout_url).toBe("https://stripe.test/checkout/cs_smoothexit_1");

    // Stripe received the catalog amount, correct product, and metadata.
    expect(captured).toBeDefined();
    const lineItem = captured!.line_items?.[0];
    expect(lineItem?.price_data?.unit_amount).toBe(44400);
    expect(lineItem?.price_data?.product_data?.name).toBe("Smooth Exit Add-ons");
    expect(lineItem?.price_data?.product_data?.description).toBe(
      "Concierge add-ons for: 456 Oak Ave"
    );
    expect(captured!.mode).toBe("payment");
    expect(captured!.metadata).toMatchObject({
      deal_id: deal.id,
      type: "smooth_exit_upsell",
    });
    expect(captured!.success_url).toContain(
      `/smooth-exit/complete?deal_id=${deal.id}&upsells=paid`
    );
    expect(captured!.cancel_url).toContain(
      `/smooth-exit/survey?deal_id=${deal.id}&cancelled=1`
    );

    // Enrollment is still persisted (upsells_paid stays false until webhook)
    // with the SERVER-computed total.
    const rows = await prisma.$queryRaw<
      { status: string; upsells_paid: boolean; upsell_total_cents: string }[]
    >`
      SELECT smooth_exit->>'status' AS status,
             (smooth_exit->>'upsells_paid')::boolean AS upsells_paid,
             smooth_exit->>'upsell_total_cents' AS upsell_total_cents
      FROM deals WHERE id = ${deal.id}::uuid
    `;
    expect(rows[0].status).toBe("active");
    expect(rows[0].upsells_paid).toBe(false);
    expect(rows[0].upsell_total_cents).toBe("44400");
  });

  it("tampered upsell_total_cents is ignored — server prices from the catalog", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id, title: "789 Pine Ln" });

    let captured: Stripe.Checkout.SessionCreateParams | undefined;
    setStripeForTesting({
      checkout: {
        sessions: {
          create: async (params: Stripe.Checkout.SessionCreateParams) => {
            captured = params;
            return {
              id: "cs_smoothexit_2",
              url: "https://stripe.test/checkout/cs_smoothexit_2",
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

    const r = new Request(`http://localhost/api/deals/${deal.id}/smoothexit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({
        payment_option: "from_proceeds",
        estimated_sale_price: 500000,
        fee_cents: 500000,
        // Hostile client claims the add-ons cost 1 cent.
        selected_upsells: ["staging_consult", "photography_upgrade"],
        upsell_total_cents: 1,
      }),
    });
    const res = await smoothExitRoute(r, ctx(deal.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean; checkout_url?: string };
    expect(json.checkout_url).toBe("https://stripe.test/checkout/cs_smoothexit_2");

    // Stripe is charged the catalog total, not the client's number.
    expect(captured).toBeDefined();
    expect(captured!.line_items?.[0]?.price_data?.unit_amount).toBe(44400);

    // And the JSONB stores the server-computed total.
    const rows = await prisma.$queryRaw<{ upsell_total_cents: string }[]>`
      SELECT smooth_exit->>'upsell_total_cents' AS upsell_total_cents
      FROM deals WHERE id = ${deal.id}::uuid
    `;
    expect(rows[0].upsell_total_cents).toBe("44400");
  });

  it("unknown upsell key → 400, no Stripe call, existing enrollment untouched", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    // Seed a prior enrollment so we can prove the bad request doesn't clobber it.
    await prisma.deals.update({
      where: { id: deal.id },
      data: {
        smooth_exit: {
          status: "active",
          payment_option: "from_proceeds",
          selected_upsells: [],
          upsell_total_cents: 0,
          upsells_paid: false,
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

    const r = new Request(`http://localhost/api/deals/${deal.id}/smoothexit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({
        payment_option: "buyer_concession",
        selected_upsells: ["staging_consult", "free_money"],
        upsell_total_cents: 1,
      }),
    });
    const res = await smoothExitRoute(r, ctx(deal.id));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("free_money");
    expect(stripeCalled).toBe(false);

    // Validation happens BEFORE persisting — the seeded enrollment survives.
    const rows = await prisma.$queryRaw<
      { payment_option: string; enrolled_at: string }[]
    >`
      SELECT smooth_exit->>'payment_option' AS payment_option,
             smooth_exit->>'enrolled_at'    AS enrolled_at
      FROM deals WHERE id = ${deal.id}::uuid
    `;
    expect(rows[0].payment_option).toBe("from_proceeds");
    expect(rows[0].enrolled_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("seller participant enrolls own deal with no upsells → 200 {ok:true}, enrollment persisted (#170)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const seller = await createUser({ role: "seller", auth0_id: "auth0|seller" });
    const deal = await createDeal({ agent_id: agent.id, title: "321 Cedar Ct" });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: seller.id, role: "seller" },
    });

    const r = new Request(`http://localhost/api/deals/${deal.id}/smoothexit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|seller", ["seller"]),
      },
      body: JSON.stringify({
        payment_option: "from_proceeds",
        estimated_sale_price: 400000,
        fee_cents: 400000,
        survey_answers: { goal: "relocate" },
        selected_upsells: [],
        upsell_total_cents: 0,
      }),
    });
    const res = await smoothExitRoute(r, ctx(deal.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean; checkout_url?: string };
    expect(json.ok).toBe(true);
    expect(json.checkout_url).toBeUndefined();

    const rows = await prisma.$queryRaw<
      { status: string; payment_option: string; upsells_paid: boolean }[]
    >`
      SELECT smooth_exit->>'status' AS status,
             smooth_exit->>'payment_option' AS payment_option,
             (smooth_exit->>'upsells_paid')::boolean AS upsells_paid
      FROM deals WHERE id = ${deal.id}::uuid
    `;
    expect(rows[0].status).toBe("active");
    expect(rows[0].payment_option).toBe("from_proceeds");
    expect(rows[0].upsells_paid).toBe(false);
  });

  it("seller participant's tampered upsell_total_cents is ignored — Stripe charges the catalog total, seller-facing return URLs (#170)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const seller = await createUser({ role: "seller", auth0_id: "auth0|seller" });
    const deal = await createDeal({ agent_id: agent.id, title: "654 Birch Blvd" });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: seller.id, role: "seller" },
    });

    let captured: Stripe.Checkout.SessionCreateParams | undefined;
    setStripeForTesting({
      checkout: {
        sessions: {
          create: async (params: Stripe.Checkout.SessionCreateParams) => {
            captured = params;
            return {
              id: "cs_smoothexit_seller",
              url: "https://stripe.test/checkout/cs_smoothexit_seller",
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

    const r = new Request(`http://localhost/api/deals/${deal.id}/smoothexit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|seller", ["seller"]),
      },
      body: JSON.stringify({
        payment_option: "from_proceeds",
        estimated_sale_price: 500000,
        fee_cents: 500000,
        // Hostile seller client claims the add-ons cost 1 cent.
        selected_upsells: ["staging_consult", "photography_upgrade"],
        upsell_total_cents: 1,
      }),
    });
    const res = await smoothExitRoute(r, ctx(deal.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean; checkout_url?: string };
    expect(json.checkout_url).toBe(
      "https://stripe.test/checkout/cs_smoothexit_seller"
    );

    // Stripe is charged the server catalog total, not the client's number.
    expect(captured).toBeDefined();
    expect(captured!.line_items?.[0]?.price_data?.unit_amount).toBe(44400);

    // Role-aware return URLs (#170): a seller lands back on THEIR portal on
    // success; cancel returns to the survey's ?deal_id entry point so a
    // resubmit works (SmoothExitSurvey keeps its handoff for exactly this).
    expect(captured!.success_url).toBe(
      `http://localhost/seller/${seller.id}?smoothexit=paid`
    );
    expect(captured!.cancel_url).toBe(
      `http://localhost/smooth-exit/survey?deal_id=${deal.id}&cancelled=1`
    );

    // The JSONB stores the SERVER-computed total.
    const rows = await prisma.$queryRaw<{ upsell_total_cents: string }[]>`
      SELECT smooth_exit->>'upsell_total_cents' AS upsell_total_cents
      FROM deals WHERE id = ${deal.id}::uuid
    `;
    expect(rows[0].upsell_total_cents).toBe("44400");
  });

  it("403 when a seller is NOT a participant on the deal — nothing persisted, no Stripe call (#170)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await createUser({ role: "seller", auth0_id: "auth0|stranger" });
    const deal = await createDeal({ agent_id: agent.id });

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

    const r = new Request(`http://localhost/api/deals/${deal.id}/smoothexit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|stranger", ["seller"]),
      },
      body: JSON.stringify({
        payment_option: "from_proceeds",
        selected_upsells: ["staging_consult"],
        upsell_total_cents: 1,
      }),
    });
    const res = await smoothExitRoute(r, ctx(deal.id));
    expect(res.status).toBe(403);
    expect(stripeCalled).toBe(false);

    const row = await prisma.deals.findUnique({ where: { id: deal.id } });
    expect(row?.smooth_exit).toBeNull();
  });

  it("403 when caller is not the deal owner", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|owner" });
    await createUser({ role: "agent", auth0_id: "auth0|other" });
    const deal = await createDeal({ agent_id: agent.id });

    const r = new Request(`http://localhost/api/deals/${deal.id}/smoothexit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|other", ["agent"]),
      },
      body: JSON.stringify({ payment_option: "from_proceeds", upsell_total_cents: 0 }),
    });
    const res = await smoothExitRoute(r, ctx(deal.id));
    expect(res.status).toBe(403);
  });

  it("404 when the deal does not exist", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const missingId = "00000000-0000-0000-0000-000000000000";

    const r = new Request(`http://localhost/api/deals/${missingId}/smoothexit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ payment_option: "from_proceeds", upsell_total_cents: 0 }),
    });
    const res = await smoothExitRoute(r, ctx(missingId));
    expect(res.status).toBe(404);
  });
});
