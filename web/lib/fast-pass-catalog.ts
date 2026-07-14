/**
 * Fast Pass catalog — the server's source of truth for enrollment pricing
 * (#78). Mirrors lib/smooth-exit-catalog.ts.
 *
 * POST /deals/[id]/fastpass computes the Stripe charge from this table and
 * ignores any client-supplied total_cents, so a tampered request can't enroll
 * for a penny. This is a deliberate divergence from the Go EnrollFastPass
 * (backend/internal/handlers/enrollment.go), which trusted the client's
 * total_cents.
 *
 * Unlike Smooth Exit (where only the add-ons go through Stripe), the Fast Pass
 * charge is the base fee PLUS any selected upsells — matching what the Go
 * handler billed and what the UI shows. The UI list in lib/fast-pass-display.ts
 * derives its displayed dollar prices from these cents, so what the user sees
 * is what the server charges.
 */
export const FAST_PASS_BASE_PRICE_CENTS = 297700;

export const FAST_PASS_UPSELL_PRICE_CENTS = {
  utility_setup: 9700,
  refi_monitoring: 14700,
  home_warranty: 9700,
  deep_clean: 19700,
  inspection_followup: 14700,
  address_change: 9700,
  storage_research: 9700,
  new_construction: 14700,
  staging_consult: 24700,
  moving_coordination: 19700,
} as const;

export type FastPassUpsellId = keyof typeof FAST_PASS_UPSELL_PRICE_CENTS;

// hasOwnProperty (not `in`) so prototype keys like "toString" don't pass.
export function isFastPassUpsellId(key: string): key is FastPassUpsellId {
  return Object.prototype.hasOwnProperty.call(FAST_PASS_UPSELL_PRICE_CENTS, key);
}

/**
 * Server-side total for a Fast Pass enrollment: base fee + the selected
 * upsells. Duplicate keys count once (pass a deduped set or rely on this to
 * collapse them). Callers must validate each key with isFastPassUpsellId
 * first — unknown keys here would be silently skipped.
 */
export function computeFastPassTotalCents(upsells: Iterable<FastPassUpsellId>): number {
  let total = FAST_PASS_BASE_PRICE_CENTS;
  for (const key of new Set(upsells)) {
    total += FAST_PASS_UPSELL_PRICE_CENTS[key];
  }
  return total;
}
