/**
 * Smooth Exit upsell catalog — the server's source of truth for add-on
 * pricing (#81).
 *
 * POST /deals/[id]/smoothexit computes the Stripe charge from this table and
 * ignores any client-supplied total, so a tampered request can't buy add-ons
 * for a penny. This is a deliberate divergence from the Go EnrollSmoothExit
 * (backend/internal/handlers/enrollment.go), which trusted the client's
 * upsell_total_cents.
 *
 * The UI list in lib/data/mockSmoothExit.ts derives its displayed dollar
 * prices from these cents, so what the user sees is what the server charges.
 */
export const SMOOTH_EXIT_UPSELL_PRICE_CENTS = {
  pre_listing_clean: 19700,
  staging_consult: 24700,
  pre_listing_inspection: 14700,
  photography_upgrade: 19700,
  storage_research: 9700,
  moving_coordination: 19700,
  address_change: 9700,
  repair_bid_coordination: 14700,
} as const;

export type SmoothExitUpsellId = keyof typeof SMOOTH_EXIT_UPSELL_PRICE_CENTS;

// hasOwnProperty (not `in`) so prototype keys like "toString" don't pass.
export function isSmoothExitUpsellId(key: string): key is SmoothExitUpsellId {
  return Object.prototype.hasOwnProperty.call(SMOOTH_EXIT_UPSELL_PRICE_CENTS, key);
}
