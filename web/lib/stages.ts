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

export const STAGE_LABELS: Record<DealStage, string> = {
  intake: "Getting Started",
  active_search: "Property Search",
  offer_active: "Offer Active",
  under_contract: "Under Contract",
  pre_close: "Pre-Close",
  closing: "Closing Day",
  post_close: "Closed!",
};
