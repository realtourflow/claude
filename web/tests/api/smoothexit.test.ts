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
        selected_upsells: ["staging"],
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
    expect(row.selected_upsells).toEqual(["staging"]);
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
        selected_upsells: ["staging", "photography"],
        upsell_total_cents: 125000,
      }),
    });
    const res = await smoothExitRoute(r, ctx(deal.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean; checkout_url?: string };
    expect(json.ok).toBe(true);
    expect(json.checkout_url).toBe("https://stripe.test/checkout/cs_smoothexit_1");

    // Stripe received the dynamic amount, correct product, and metadata.
    expect(captured).toBeDefined();
    const lineItem = captured!.line_items?.[0];
    expect(lineItem?.price_data?.unit_amount).toBe(125000);
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

    // Enrollment is still persisted (upsells_paid stays false until webhook).
    const rows = await prisma.$queryRaw<{ status: string; upsells_paid: boolean }[]>`
      SELECT smooth_exit->>'status' AS status,
             (smooth_exit->>'upsells_paid')::boolean AS upsells_paid
      FROM deals WHERE id = ${deal.id}::uuid
    `;
    expect(rows[0].status).toBe("active");
    expect(rows[0].upsells_paid).toBe(false);
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
