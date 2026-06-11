import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { error } from "@/lib/http";
import { constructEvent } from "@/lib/stripe";

export async function POST(req: Request): Promise<Response> {
  const sig = req.headers.get("stripe-signature") ?? "";
  const payload = await req.text();
  let event: Stripe.Event;
  try {
    event = constructEvent(payload, sig);
  } catch (err) {
    console.error("stripe webhook signature error", err);
    return error("invalid signature", 400);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status !== "paid") {
        return new Response(null, { status: 200 });
      }
      const dealId = session.metadata?.deal_id;
      if (dealId) {
        // The session's metadata.type (set by its creator in lib/stripe.ts)
        // decides which product was bought. Ports the type switch in
        // backend/internal/handlers/stripe.go, except unknown/missing types
        // are a logged no-op here instead of defaulting to the closing fee.
        const type = session.metadata?.type;
        if (type === "closing_fee") {
          await markFeePaid(dealId, session.id);
        } else if (type === "smooth_exit_upsell") {
          await markSmoothExitUpsellPaid(dealId, session.id);
        } else {
          console.warn(
            `stripe webhook: unhandled checkout session type ${JSON.stringify(
              type ?? null
            )} for deal ${dealId}`
          );
        }
      }
    } else if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as Stripe.PaymentIntent;
      const dealId = pi.metadata?.deal_id;
      if (dealId) {
        await markFeePaid(dealId, pi.id);
      }
    }
  } catch (err) {
    console.error("stripe webhook handler error", err);
    // 500 so Stripe redelivers (#81). Retrying is safe: markFeePaid and
    // markSmoothExitUpsellPaid are idempotent status writes — re-running them
    // converges on the same terminal state (fee_status='paid' /
    // upsells_paid=true with the same session id). Returning 200 here would
    // eat the payment on a transient DB failure: money taken in Stripe, fee
    // never marked paid, and no redelivery to recover.
    return error("webhook handler error", 500);
  }

  // Signature-valid but unhandled/ignorable event types fall through to 200.
  return new Response(null, { status: 200 });
}

async function markFeePaid(dealId: string, sessionId: string): Promise<void> {
  await prisma.deals.updateMany({
    where: { id: dealId, fee_status: { not: "waived" } },
    data: {
      fee_status: "paid",
      fee_checkout_session_id: sessionId,
      fee_paid_at: new Date(),
    },
  });
}

// Ports markSmoothExitUpsellPaid (backend/internal/handlers/stripe.go), plus
// records which session paid and when so the payment is traceable from the
// enrollment JSONB. COALESCE preserves the payment evidence even if the
// enrollment was cleared between checkout and webhook delivery.
async function markSmoothExitUpsellPaid(
  dealId: string,
  sessionId: string
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE deals
    SET smooth_exit = jsonb_set(
      jsonb_set(
        jsonb_set(COALESCE(smooth_exit, '{}'::jsonb), '{upsells_paid}', 'true'),
        '{upsells_checkout_session_id}', to_jsonb(${sessionId}::text)
      ),
      '{upsells_paid_at}', to_jsonb(NOW()::text)
    )
    WHERE id = ${dealId}::uuid
  `;
}
