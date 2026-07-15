import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { hasDealAccess } from "@/lib/deals";
import { resolveUserId } from "@/lib/users";
import {
  computeFastPassTotalCents,
  isFastPassUpsellId,
  type FastPassUpsellId,
} from "@/lib/fast-pass-catalog";
import { createFastPassCheckout } from "@/lib/stripe";
import { fastPassEnrollBodySchema } from "@/lib/schemas/enrollment";
import { parseBody } from "@/lib/schemas/parse";

type Ctx = { params: Promise<{ id: string }> };

const PAYMENT_OPTIONS = ["now", "at_closing", "seller_concession"] as const;

// POST /deals/:dealId/fastpass — owning agent or any deal participant (#169:
// buyers enroll their own deal from the portal pitch; the price is computed
// server-side, so opening the route to participants stays tamper-safe).
// Stores Fast Pass enrollment JSONB on the deal. If payment_option === "now"
// and Stripe is configured, charges the full enrollment (base + add-ons)
// upfront via Stripe Checkout and returns a checkout_url. Ports EnrollFastPass
// (backend/internal/handlers/enrollment.go), except the total is priced
// server-side from lib/fast-pass-catalog.ts (#78) instead of trusting the
// client's total_cents.
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
    // Owner short-circuits; anyone else must be a deal participant (buyer,
    // seller, …) — hasDealAccess covers both, but the owner check avoids the
    // extra query on the common agent path.
    const isOwner = deal.agent_id === userId;
    if (!isOwner && !(await hasDealAccess(dealId, userId))) {
      return error("forbidden", 403);
    }

    // Schema-validated (#88): typed junk 400s here before any write.
    const parsed = await parseBody(req, fastPassEnrollBodySchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    // Whitelist the payment option (now | at_closing | seller_concession);
    // only "now" charges upfront. Validated before any write.
    const paymentOption = body.payment_option ?? "";
    if (!(PAYMENT_OPTIONS as readonly string[]).includes(paymentOption)) {
      return error(`invalid payment_option: ${paymentOption}`, 400);
    }

    const selectedUpsells = body.selected_upsells ?? [];

    // Server-side pricing (#78): the total is computed from the shared catalog
    // (base fee + selected upsells, plus the +15% deferral premium when
    // payment_option === "at_closing" — #280) — body.total_cents is ignored, so
    // a tampered client can't set its own price. Unknown keys 400 before
    // anything is persisted; duplicate keys count once. (Deliberate divergence
    // from the Go handler, which trusted the client's total_cents.)
    const validatedUpsells: FastPassUpsellId[] = [];
    for (const key of new Set(selectedUpsells)) {
      if (!isFastPassUpsellId(key)) {
        return error(`unknown upsell: ${key}`, 400);
      }
      validatedUpsells.push(key);
    }
    const totalCents = computeFastPassTotalCents(validatedUpsells, paymentOption);

    const enrollment = {
      status: "active",
      payment_option: paymentOption,
      // Dedupe what we store so the JSONB matches what was actually charged.
      selected_upsells: validatedUpsells,
      total_cents: totalCents,
      survey_answers: (body.survey_answers ?? null) as object | null,
      paid: false,
      enrolled_at: new Date().toISOString(),
    };

    await prisma.deals.update({
      where: { id: dealId },
      data: { fast_pass: enrollment, updated_at: new Date() },
    });

    // Only "now" charges upfront. The enrollment is already persisted, so any
    // Stripe failure (including no key configured) falls back to a plain ok —
    // mirrors the Go handler's deferred path.
    if (paymentOption === "now") {
      const url = new URL(req.url);
      const origin = `${url.protocol}//${url.host}`;
      // Role-aware return URLs (#169): the owning agent lands back on the
      // deal page; a participant (buyer) returns to their own portal on
      // success, and to the survey's ?deal_id entry point on cancel so a
      // resubmit works (FastPassSurvey keeps its handoff for exactly this).
      const successUrl = isOwner
        ? `${origin}/agent/deals/${dealId}?fastpass=paid`
        : `${origin}/buyer/${userId}?fastpass=paid`;
      const cancelUrl = isOwner
        ? `${origin}/agent/deals/${dealId}`
        : `${origin}/fast-pass/survey?deal_id=${dealId}`;
      try {
        const session = await createFastPassCheckout({
          dealId,
          dealTitle: deal.title,
          amountCents: totalCents,
          successUrl,
          cancelUrl,
        });
        if (session.url) {
          return json({ ok: true, checkout_url: session.url });
        }
      } catch (err) {
        console.error("stripe fast pass checkout error", err);
      }
    }

    return json({ ok: true });
  })) as Response;
}
