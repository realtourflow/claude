/**
 * Canonical "Buyer's Progress" steps (#184). Single source of truth shared by:
 *  - the agent setter (components/pages/agent/DealDetail.tsx)
 *  - the seller portal reader (components/pages/seller/SellerView.tsx)
 *  - the PATCH /api/deals/[id]/buyer-status validator
 *
 * Stored in deals.buyer_status (TEXT, NULL = not set). Order matters — the
 * seller portal renders these as an ordered progress checklist and marks
 * everything before the current value complete.
 */
export const BUYER_STATUS_STEPS: readonly string[] = [
  "Inspection scheduled",
  "Inspection complete",
  "Appraisal ordered",
  "Appraisal complete",
  "Financing in review",
  "Financing approved",
  "Clear to close",
];

export function isBuyerStatus(value: string): boolean {
  return BUYER_STATUS_STEPS.includes(value);
}
