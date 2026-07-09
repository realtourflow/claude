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
