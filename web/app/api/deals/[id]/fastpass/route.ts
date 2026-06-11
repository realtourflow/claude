import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import {
  computeFastPassTotalCents,
  isFastPassUpsellId,
  type FastPassUpsellId,
} from "@/lib/fast-pass-catalog";
import { createFastPassCheckout } from "@/lib/stripe";

type Ctx = { params: Promise<{ id: string }> };

type EnrollBody = {
  payment_option?: string; // now | at_closing | seller_concession
  selected_upsells?: string[];
  total_cents?: number; // client-sent; deliberately ignored — the server prices the enrollment
  survey_answers?: unknown; // arbitrary JSON from the survey
};

const PAYMENT_OPTIONS = ["now", "at_closing", "seller_concession"] as const;

// POST /deals/:dealId/fastpass — owner-only.
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
    if (deal.agent_id !== userId) return error("forbidden", 403);

    let body: EnrollBody;
    try {
      body = (await req.json()) as EnrollBody;
    } catch {
      return error("invalid request body", 400);
    }

    // Whitelist the payment option (now | at_closing | seller_concession);
    // only "now" charges upfront. Validated before any write.
    const paymentOption = body.payment_option ?? "";
    if (!(PAYMENT_OPTIONS as readonly string[]).includes(paymentOption)) {
      return error(`invalid payment_option: ${paymentOption}`, 400);
    }

    if (body.selected_upsells !== undefined && !Array.isArray(body.selected_upsells)) {
      return error("selected_upsells must be an array", 400);
    }
    const selectedUpsells = body.selected_upsells ?? [];

    // Server-side pricing (#78): the total is computed from the shared catalog
    // (base fee + selected upsells) — body.total_cents is ignored, so a
    // tampered client can't set its own price. Unknown keys 400 before anything
    // is persisted; duplicate keys count once. (Deliberate divergence from the
    // Go handler, which trusted the client's total_cents.)
    const validatedUpsells: FastPassUpsellId[] = [];
    for (const key of new Set(selectedUpsells)) {
      if (!isFastPassUpsellId(key)) {
        return error(`unknown upsell: ${key}`, 400);
      }
      validatedUpsells.push(key);
    }
    const totalCents = computeFastPassTotalCents(validatedUpsells);

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
      try {
        const session = await createFastPassCheckout({
          dealId,
          dealTitle: deal.title,
          amountCents: totalCents,
          successUrl: `${origin}/agent/deals/${dealId}?fastpass=paid`,
          cancelUrl: `${origin}/agent/deals/${dealId}`,
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
