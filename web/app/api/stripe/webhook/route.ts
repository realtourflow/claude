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
        await prisma.deals.updateMany({
          where: { id: dealId, fee_status: { not: "waived" } },
          data: {
            fee_status: "paid",
            fee_checkout_session_id: session.id,
            fee_paid_at: new Date(),
          },
        });
      }
    } else if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as Stripe.PaymentIntent;
      const dealId = pi.metadata?.deal_id;
      if (dealId) {
        await prisma.deals.updateMany({
          where: { id: dealId, fee_status: { not: "waived" } },
          data: {
            fee_status: "paid",
            fee_checkout_session_id: pi.id,
            fee_paid_at: new Date(),
          },
        });
      }
    }
  } catch (err) {
    console.error("stripe webhook handler error", err);
    // We still 200 — Stripe should not retry indefinitely on our bug.
  }

  return new Response(null, { status: 200 });
}
