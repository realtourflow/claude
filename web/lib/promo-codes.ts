/**
 * Promo-code redemption (#281).
 *
 * Admins can CRUD `promo_codes` (see app/api/admin/promo-codes/*), but nothing
 * ever redeemed one. This is the shared, server-side validation + pricing seam
 * that makes a code actually discount a purchase.
 *
 * `redeemPromoCode(code, appliesTo, subtotalCents)` looks the code up, runs
 * every guard (exists, not expired, applies to the target product, not past
 * `max_uses`), and returns the discount to subtract from the caller's
 * server-computed subtotal — or a typed rejection with a human message.
 *
 * IMPORTANT — this function does NOT write. It never trusts a client-supplied
 * discount, and it deliberately leaves the `uses_count++` to the caller so the
 * increment can be committed in the SAME transaction as the enrollment/order
 * write (a conditional `WHERE uses_count < max_uses` update), closing the
 * double-spend race two concurrent redemptions would otherwise open. See the
 * Fast Pass route for the reference wiring.
 *
 * SERVER ONLY — imports the Prisma client. Client code that wants a discount
 * preview must reimplement the (pure) math; the server stays the boundary.
 */
import { prisma } from "@/lib/db";

export type PromoRedemption = {
  ok: true;
  promoId: string;
  /** Normalized (trimmed, upper-cased) code as stored. */
  code: string;
  /** null = unlimited uses. Callers guard the transactional increment with it. */
  maxUses: number | null;
  /** Discount to subtract from the subtotal, already clamped to [0, subtotal]. */
  discountCents: number;
  /** subtotalCents - discountCents. */
  discountedCents: number;
};

export type PromoRejection = { ok: false; reason: string };

export type PromoResult = PromoRedemption | PromoRejection;

/** Prisma returns `discount_value` as a Decimal; coerce to a plain number. */
function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
}

/**
 * The discount (in cents) a code applies to a subtotal. Pure + clamped to
 * [0, subtotalCents] so a code can never push a total negative or below zero.
 * - `pct`   → `discount_value` is a percentage (10 = 10% off).
 * - `fixed` → `discount_value` is DOLLARS (admin UI labels it "Fixed ($)"),
 *              so $100 off = 10000 cents.
 * Any other type (shouldn't occur — admin validates) yields no discount.
 */
export function computeDiscountCents(
  discountType: string,
  discountValue: number,
  subtotalCents: number
): number {
  if (!(discountValue > 0) || subtotalCents <= 0) return 0;
  let raw: number;
  if (discountType === "pct") {
    raw = Math.round((subtotalCents * discountValue) / 100);
  } else if (discountType === "fixed") {
    raw = Math.round(discountValue * 100);
  } else {
    return 0;
  }
  return Math.max(0, Math.min(raw, subtotalCents));
}

/**
 * Validate a promo code against a target product + server-computed subtotal.
 * Read-only: on success the caller must still increment `uses_count`
 * transactionally with its own write (guarded by `maxUses`).
 *
 * @param code          Raw user input (normalized here — trim + upper-case).
 * @param appliesTo     Product key the code must include in `applies_to`
 *                      (e.g. "fast_pass").
 * @param subtotalCents Server-computed pre-discount subtotal.
 */
export async function redeemPromoCode(
  code: string,
  appliesTo: string,
  subtotalCents: number
): Promise<PromoResult> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return { ok: false, reason: "promo code is required" };

  const promo = await prisma.promo_codes.findUnique({
    where: { code: normalized },
    select: {
      id: true,
      code: true,
      discount_type: true,
      discount_value: true,
      applies_to: true,
      max_uses: true,
      uses_count: true,
      expires_at: true,
    },
  });
  if (!promo) return { ok: false, reason: "promo code not found" };

  if (promo.expires_at && promo.expires_at.getTime() <= Date.now()) {
    return { ok: false, reason: "promo code has expired" };
  }

  if (!promo.applies_to.includes(appliesTo)) {
    return { ok: false, reason: "promo code is not valid for this purchase" };
  }

  // Fast pre-check; the transactional increment is the real double-spend guard.
  if (promo.max_uses != null && promo.uses_count >= promo.max_uses) {
    return { ok: false, reason: "promo code has reached its usage limit" };
  }

  const discountCents = computeDiscountCents(
    promo.discount_type,
    toNumber(promo.discount_value),
    subtotalCents
  );

  return {
    ok: true,
    promoId: promo.id,
    code: promo.code,
    maxUses: promo.max_uses,
    discountCents,
    discountedCents: subtotalCents - discountCents,
  };
}
