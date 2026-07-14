export const STAGE_ORDER = [
  "intake",
  "active_search",
  "offer_active",
  "under_contract",
  "pre_close",
  "closing",
  "post_close",
] as const;

export type DealStage = (typeof STAGE_ORDER)[number];

export type DealType = "buy" | "sell";

export type TaskStatus = "pending" | "in_progress" | "completed" | "skipped";

export function stageIndex(s: string): number {
  return STAGE_ORDER.indexOf(s as DealStage);
}

export function isForwardAdvance(from: string, to: string): boolean {
  const a = stageIndex(from);
  const b = stageIndex(to);
  return a >= 0 && b > a;
}

/** Client-facing stage labels (buyer/seller notifications, stage-advance emails). */
export const STAGE_LABELS: Record<DealStage, string> = {
  intake: "Getting Started",
  active_search: "Property Search",
  offer_active: "Offer Active",
  under_contract: "Under Contract",
  pre_close: "Pre-Close",
  closing: "Closing Day",
  post_close: "Closed!",
};

/**
 * Internal stage labels for the agent / admin / TC views. Previously
 * copy-pasted into ~7 components (#89); this is now the single source.
 * Text intentionally differs from STAGE_LABELS above, which is the
 * client-facing wording.
 */
export const AGENT_STAGE_LABELS: Record<DealStage, string> = {
  intake: "Intake",
  active_search: "Active Search",
  offer_active: "Offer Active",
  under_contract: "Under Contract",
  pre_close: "Pre-Close",
  closing: "Closing",
  post_close: "Post-Close",
};
