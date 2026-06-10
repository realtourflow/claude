import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import {
  SMOOTH_EXIT_UPSELL_PRICE_CENTS,
  isSmoothExitUpsellId,
} from "@/lib/smooth-exit-catalog";
import { createSmoothExitUpsellCheckout } from "@/lib/stripe";

type Ctx = { params: Promise<{ id: string }> };

type EnrollBody = {
  payment_option?: string; // from_proceeds | buyer_concession
  estimated_sale_price?: number;
  fee_cents?: number;
  survey_answers?: unknown; // arbitrary JSON from the survey
  selected_upsells?: string[];
  upsell_total_cents?: number; // client-sent; deliberately ignored — the server prices upsells
};

// POST /deals/:dealId/smoothexit — owner-only.
// Stores Smooth Exit enrollment JSONB on the deal. If upsells were selected and
// Stripe is configured, charges them upfront via Stripe Checkout and returns a
// checkout_url. Ports EnrollSmoothExit (backend/internal/handlers/enrollment.go),
// except the upsell total is priced server-side from lib/smooth-exit-catalog.ts
// (#81) instead of trusting the client's upsell_total_cents.
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    const deal = await prisma.deals.findFirst({
      where: { id: dealId },
      select: { agent_id: true, title: true },
    });
    if (!deal) return error("deal not found", 404);
    if (deal.agent_id !== userId) return error("forbidden", 403);

    let body: EnrollBody;
    try {
      body = (await req.json()) as EnrollBody;
    } catch {
      return error("invalid request body", 400);
    }

    if (body.selected_upsells !== undefined && !Array.isArray(body.selected_upsells)) {
      return error("selected_upsells must be an array", 400);
    }
    const selectedUpsells = body.selected_upsells ?? [];

    // Server-side pricing (#81): the upsell total is computed from the shared
    // catalog — body.upsell_total_cents is ignored, so a tampered client can't
    // set its own price. Unknown keys 400 before anything is persisted.
    // Duplicate keys count once, matching calcSmoothExitUpsellTotal in
    // lib/data/mockSmoothExit.ts. (Deliberate divergence from the Go handler,
    // which trusted the client's total.)
    let upsellTotalCents = 0;
    for (const key of new Set(selectedUpsells)) {
      if (!isSmoothExitUpsellId(key)) {
        return error(`unknown upsell: ${key}`, 400);
      }
      upsellTotalCents += SMOOTH_EXIT_UPSELL_PRICE_CENTS[key];
    }

    const enrollment = {
      status: "active",
      payment_option: body.payment_option ?? "",
      estimated_sale_price: body.estimated_sale_price ?? 0,
      fee_cents: body.fee_cents ?? 0,
      survey_answers: (body.survey_answers ?? null) as object | null,
      selected_upsells: selectedUpsells,
      upsell_total_cents: upsellTotalCents,
      upsells_paid: false,
      enrolled_at: new Date().toISOString(),
    };

    await prisma.deals.update({
      where: { id: dealId },
      data: { smooth_exit: enrollment, updated_at: new Date() },
    });

    // If upsells were selected, charge them upfront via Stripe. The enrollment
    // is already persisted, so any Stripe failure (including no key configured)
    // falls back to a plain ok — mirrors the Go handler.
    if (upsellTotalCents > 0) {
      const url = new URL(req.url);
      const origin = `${url.protocol}//${url.host}`;
      try {
        const session = await createSmoothExitUpsellCheckout({
          dealId,
          dealTitle: deal.title,
          amountCents: upsellTotalCents,
          successUrl: `${origin}/smooth-exit/complete?deal_id=${dealId}&upsells=paid`,
          cancelUrl: `${origin}/smooth-exit/survey?deal_id=${dealId}&cancelled=1`,
        });
        if (session.url) {
          return json({ ok: true, checkout_url: session.url });
        }
      } catch (err) {
        console.error("stripe smooth exit upsell checkout error", err);
      }
    }

    return json({ ok: true });
  })) as Response;
}
