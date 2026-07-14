/**
 * Stripe wrapper. Mirrors the surface used in the legacy Go backend.
 *
 * - createCheckoutSession({...}) → returns Stripe Checkout Session
 * - constructEvent(payload, sig) → verifies webhook signature, returns event
 *
 * Test seam: setStripeForTesting() lets us inject a stub that bypasses real
 * Stripe calls.
 */
import Stripe from "stripe";
import { env } from "./env";

export const CLOSING_FEE_CENTS = 7500;

type StripeLike = {
  checkout: {
    sessions: {
      create: (
        params: Stripe.Checkout.SessionCreateParams
      ) => Promise<Pick<Stripe.Checkout.Session, "id" | "url">>;
      // Optional so existing test stubs that only stub `create` still satisfy
      // the type (backward-compatible seam). The real Stripe client always has
      // it; only routes that call retrieveCheckoutSession need a stub for it.
      retrieve?: (
        id: string
      ) => Promise<Pick<Stripe.Checkout.Session, "id" | "url" | "status">>;
    };
  };
  webhooks: {
    constructEvent: (
      payload: string | Buffer,
      header: string,
      secret: string
    ) => Stripe.Event;
  };
};

let stub: StripeLike | undefined;
let real: Stripe | undefined;

export function setStripeForTesting(impl: StripeLike | undefined): void {
  stub = impl;
}

function client(): StripeLike {
  if (stub) return stub;
  if (!real) {
    const key = env().STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
    real = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
  }
  return real as unknown as StripeLike;
}

export type CreateCheckoutInput = {
  dealId: string;
  dealTitle: string;
  successUrl: string;
  cancelUrl: string;
};

export async function createCheckoutSession(
  input: CreateCheckoutInput
): Promise<{ id: string; url: string | null }> {
  const session = await client().checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: "RealTour Flow Closing Fee",
            description: `Closing fee for deal: ${input.dealTitle}`,
          },
          unit_amount: CLOSING_FEE_CENTS,
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: { deal_id: input.dealId, type: "closing_fee" },
  });
  return { id: session.id, url: session.url ?? null };
}

export type CheckoutSessionSnapshot = {
  id: string;
  url: string | null;
  // Stripe's session status ('open' | 'complete' | 'expired') or null. Indexed
  // access (not `Session.Status`) — the namespace isn't reachable through the
  // default import.
  status: Stripe.Checkout.Session["status"];
};

/**
 * Fetch the live status of an existing Checkout Session. Lets a caller tell an
 * abandoned/`expired` session (safe to replace) from one still `open` (must be
 * reused — minting a second payable session would double-charge). Used by the
 * closing-fee checkout route (#282).
 */
export async function retrieveCheckoutSession(
  sessionId: string
): Promise<CheckoutSessionSnapshot> {
  const sessions = client().checkout.sessions;
  if (!sessions.retrieve) {
    throw new Error("checkout.sessions.retrieve is not available");
  }
  const session = await sessions.retrieve(sessionId);
  return {
    id: session.id,
    url: session.url ?? null,
    status: session.status ?? null,
  };
}

export type CreateUpsellCheckoutInput = {
  dealId: string;
  dealTitle: string;
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
};

/**
 * Smooth Exit concierge add-ons checkout. Unlike the fixed closing fee, the
 * amount is dynamic (sum of selected upsells) and the metadata marks it as a
 * smooth_exit_upsell. Mirrors EnrollSmoothExit in
 * the legacy Go backend.
 */
export async function createSmoothExitUpsellCheckout(
  input: CreateUpsellCheckoutInput
): Promise<{ id: string; url: string | null }> {
  const session = await client().checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: "Smooth Exit Add-ons",
            description: `Concierge add-ons for: ${input.dealTitle}`,
          },
          unit_amount: input.amountCents,
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: { deal_id: input.dealId, type: "smooth_exit_upsell" },
  });
  return { id: session.id, url: session.url ?? null };
}

/**
 * Fast Pass enrollment checkout. The amount is the full enrollment priced
 * server-side (base fee + selected add-ons) and the metadata marks it as a
 * fast_pass. Mirrors EnrollFastPass in
 * backend/internal/handlers/enrollment.go.
 */
export async function createFastPassCheckout(
  input: CreateUpsellCheckoutInput
): Promise<{ id: string; url: string | null }> {
  const session = await client().checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: "Fast Pass Concierge Service",
            description: `Fast Pass enrollment for ${input.dealTitle}`,
          },
          unit_amount: input.amountCents,
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: { deal_id: input.dealId, type: "fast_pass" },
  });
  return { id: session.id, url: session.url ?? null };
}

export function constructEvent(
  payload: string | Buffer,
  signature: string
): Stripe.Event {
  // When a stub is injected (tests), it doesn't actually verify the secret —
  // so we pass an empty string. The real Stripe SDK requires a real secret
  // from env.
  const secret = stub ? "" : env().STRIPE_WEBHOOK_SECRET;
  if (!stub && !secret) throw new Error("STRIPE_WEBHOOK_SECRET not configured");
  return client().webhooks.constructEvent(payload, signature, secret);
}
