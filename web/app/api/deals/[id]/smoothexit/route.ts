import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { hasDealAccess } from "@/lib/deals";
import { resolveUserId } from "@/lib/users";
import {
  SMOOTH_EXIT_UPSELL_PRICE_CENTS,
  isSmoothExitUpsellId,
} from "@/lib/smooth-exit-catalog";
import { createSmoothExitUpsellCheckout } from "@/lib/stripe";
import { smoothExitEnrollBodySchema } from "@/lib/schemas/enrollment";
import { parseBody } from "@/lib/schemas/parse";

type Ctx = { params: Promise<{ id: string }> };

// POST /deals/:dealId/smoothexit — owning agent or any deal participant (#170:
// sellers enroll their own deal from the portal pitch; upsells are priced
// server-side, so opening the route to participants stays tamper-safe).
// Stores Smooth Exit enrollment JSONB on the deal. If upsells were selected and
// Stripe is configured, charges them upfront via Stripe Checkout and returns a
// checkout_url. Ports EnrollSmoothExit (the legacy Go backend), except the
// upsell total is priced server-side from lib/smooth-exit-catalog.ts (#81)
// instead of trusting the client's upsell_total_cents.
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
    // Owner short-circuits; anyone else must be a deal participant (seller,
    // buyer, …) — hasDealAccess covers both, but the owner check avoids the
    // extra query on the common agent path. (Same pattern as fastpass, #169.)
    const isOwner = deal.agent_id === userId;
    if (!isOwner && !(await hasDealAccess(dealId, userId))) {
      return error("forbidden", 403);
    }

    // Schema-validated (#88): typed junk (string prices, numeric
    // payment_option, non-array upsells) 400s here instead of persisting
    // into the smooth_exit JSONB.
    const parsed = await parseBody(req, smoothExitEnrollBodySchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

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
      // Dedupe what we store so the JSONB matches what was actually charged.
      selected_upsells: [...new Set(selectedUpsells)],
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
      // Role-aware success URL (#170): a participant (seller) returns to their
      // own portal after paying; the owning agent keeps the legacy completion
      // URL. Cancel returns both to the survey's ?deal_id entry point so a
      // resubmit works (SmoothExitSurvey keeps its handoff for exactly this).
      const successUrl = isOwner
        ? `${origin}/smooth-exit/complete?deal_id=${dealId}&upsells=paid`
        : `${origin}/seller/${userId}?smoothexit=paid`;
      try {
        const session = await createSmoothExitUpsellCheckout({
          dealId,
          dealTitle: deal.title,
          amountCents: upsellTotalCents,
          successUrl,
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
