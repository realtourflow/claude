import { prisma } from "./db";
import { isLinkedTCForDeal } from "./deals";
import { hasRole } from "./roles";

export const CHECKLIST_ELIGIBLE_STAGES = new Set([
  "under_contract",
  "pre_close",
  "closing",
  "post_close",
]);

export type DefaultChecklistItem = {
  label: string;
  category: string;
  assignedTo: "tc" | "agent" | "buyer" | "seller" | "third_party";
};

// ── Seller-portal defaults (#261) ────────────────────────────────────────────
// The seller portal's Listing Prep and Pre-Close cards are backed by real,
// persisted checklist_items (assigned_to='seller') instead of cosmetic local
// state. These sets are keyed by deal TYPE + STAGE (see sellerDefaultsFor), NOT
// by CHECKLIST_ELIGIBLE_STAGES, so they seed at active_search / pre_close for
// sell deals only. Labels intentionally match the seller-portal card copy so a
// seeded item shows up as the same row the seller already expects to see.

// Seeded at active_search ("Listing Prep") for sell deals.
export const SELLER_LISTING_PREP_ITEMS: DefaultChecklistItem[] = [
  { label: "Deep clean / declutter", category: "Listing Prep", assignedTo: "seller" },
  { label: "Minor repairs completed", category: "Listing Prep", assignedTo: "seller" },
  { label: "Professional photos scheduled", category: "Listing Prep", assignedTo: "seller" },
  { label: "Listing copy approved", category: "Listing Prep", assignedTo: "seller" },
  { label: "Disclosures package complete", category: "Listing Prep", assignedTo: "seller" },
  { label: "Lockbox installed", category: "Listing Prep", assignedTo: "seller" },
];

// Seeded at pre_close for sell deals.
export const SELLER_PRE_CLOSE_ITEMS: DefaultChecklistItem[] = [
  { label: "Complete agreed repairs", category: "Pre-Close", assignedTo: "seller" },
  { label: "Remove all personal belongings", category: "Pre-Close", assignedTo: "seller" },
  { label: "Schedule final walkthrough access", category: "Pre-Close", assignedTo: "seller" },
  { label: "Confirm possession date", category: "Pre-Close", assignedTo: "seller" },
  { label: "Utilities transfer arranged", category: "Pre-Close", assignedTo: "seller" },
];

// Which seller default set (if any) belongs to a deal at a given type + stage.
// Only sell deals seed seller items; buy deals get none here (their loan-side
// coordination lives in the TC set below). Returns [] when nothing applies.
export function sellerDefaultsFor(
  type: string,
  stage: string
): DefaultChecklistItem[] {
  if (type !== "sell") return [];
  if (stage === "active_search") return SELLER_LISTING_PREP_ITEMS;
  if (stage === "pre_close") return SELLER_PRE_CLOSE_ITEMS;
  return [];
}

export const DEFAULT_CHECKLIST_ITEMS: DefaultChecklistItem[] = [
  { label: "Contract received and reviewed", category: "Contract", assignedTo: "tc" },
  { label: "Earnest money deposit verified", category: "Contract", assignedTo: "tc" },
  { label: "All parties have signed contract", category: "Contract", assignedTo: "tc" },
  { label: "Loan application submitted", category: "Loan", assignedTo: "tc" },
  { label: "Disclosures out", category: "Loan", assignedTo: "tc" },
  { label: "Disclosures signed and submitted", category: "Loan", assignedTo: "tc" },
  { label: "Approved with conditions", category: "Loan", assignedTo: "tc" },
  { label: "Appraisal ordered", category: "Loan", assignedTo: "tc" },
  { label: "Clear to close received", category: "Loan", assignedTo: "tc" },
  { label: "Title ordered", category: "Title", assignedTo: "tc" },
  { label: "Title search complete", category: "Title", assignedTo: "tc" },
  { label: "Title commitment received", category: "Title", assignedTo: "tc" },
  { label: "Wire instructions confirmed", category: "Title", assignedTo: "tc" },
  { label: "Closing date confirmed with all parties", category: "Closing", assignedTo: "tc" },
  { label: "Closing disclosure sent", category: "Closing", assignedTo: "tc" },
  { label: "Final walkthrough scheduled", category: "Closing", assignedTo: "agent" },
  { label: "Keys and access items prepared", category: "Closing", assignedTo: "tc" },
];

export async function checklistHasAccess(
  dealId: string,
  userId: string,
  roles: readonly string[]
): Promise<boolean> {
  if (hasRole(roles, ["admin"])) return true;
  // A TC only has access when the deal's owning agent linked them (#172).
  if (hasRole(roles, ["tc"]) && (await isLinkedTCForDeal(dealId, userId))) {
    return true;
  }
  const deal = await prisma.deals.findFirst({
    where: {
      id: dealId,
      OR: [
        { agent_id: userId },
        { deal_participants: { some: { user_id: userId } } },
      ],
    },
    select: { id: true },
  });
  return !!deal;
}
