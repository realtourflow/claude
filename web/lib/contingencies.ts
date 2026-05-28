import { prisma } from "./db";
import { hasRole } from "./roles";

export async function contingencyHasAccess(
  dealId: string,
  userId: string,
  roles: readonly string[]
): Promise<boolean> {
  if (hasRole(roles, ["tc", "admin"])) return true;
  const deal = await prisma.deals.findFirst({
    where: { id: dealId, agent_id: userId },
    select: { id: true },
  });
  return !!deal;
}

export type ContingencyRow = {
  id: string;
  deal_id: string;
  label: string;
  contingency_type: string;
  deadline: string | null;
  status: "active" | "waived" | "removed";
  notes: string | null;
  sort_order: number;
  created_at: string;
};

export type RawContingencyRow = {
  id: string;
  deal_id: string;
  label: string;
  contingency_type: string;
  deadline: string | null;
  waived_at: Date | null;
  met_at: Date | null;
  notes: string | null;
  sort_order: number;
  created_at: Date;
};

export function toApiContingency(r: RawContingencyRow): ContingencyRow {
  return {
    id: r.id,
    deal_id: r.deal_id,
    label: r.label,
    contingency_type: r.contingency_type,
    deadline: r.deadline,
    status: r.waived_at ? "waived" : r.met_at ? "removed" : "active",
    notes: r.notes,
    sort_order: r.sort_order,
    created_at: r.created_at.toISOString(),
  };
}
