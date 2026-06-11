import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "./db";

/**
 * Health CASE expression. Ported verbatim from the legacy Go backend.
 *
 * Red    = any incomplete task with a past due_date.
 * Yellow = deal has been in current stage longer than the stage threshold AND has
 *          incomplete tasks.
 * Green  = otherwise.
 *
 * Use as a column expression inside SELECTs that include the `deals` table:
 *   SELECT ${healthExpr} AS health, ... FROM deals ...
 */
export const healthExpr = Prisma.sql`
CASE
  WHEN EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.deal_id = deals.id
      AND t.status NOT IN ('completed','skipped')
      AND t.due_date IS NOT NULL
      AND t.due_date < CURRENT_DATE
  ) THEN 'red'
  WHEN FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(
    (SELECT changed_at FROM deal_stage_history dsh
     WHERE dsh.deal_id = deals.id ORDER BY dsh.changed_at DESC LIMIT 1),
    deals.created_at
  ))) / 86400)::INT >
    CASE deals.stage
      WHEN 'intake'          THEN 5
      WHEN 'active_search'   THEN 30
      WHEN 'offer_active'    THEN 10
      WHEN 'under_contract'  THEN 35
      WHEN 'pre_close'       THEN 10
      WHEN 'closing'         THEN 5
      WHEN 'post_close'      THEN 21
      ELSE 30
    END
  AND EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.deal_id = deals.id AND t.status NOT IN ('completed','skipped')
  )
  THEN 'yellow'
  ELSE 'green'
END
`;

export type DealRow = {
  id: string;
  agent_id: string;
  type: string;
  stage: string;
  health: string;
  title: string;
  address: string | null;
  price: string | null;
  arive_linked: boolean;
  arive_milestones: unknown;
  arive_key_dates: unknown;
  arive_loan_status: string | null;
  fee_status: string;
  fee_amount_cents: number;
  fee_paid_at: Date | null;
  fast_pass: unknown;
  smooth_exit: unknown;
  pre_approved: boolean;
  baa_signed: boolean;
  commission_pct: string | null;
  created_at: Date;
  updated_at: Date;
};

export type DealWithStats = DealRow & {
  agent_name: string;
  agent_email: string;
  agent_phone: string | null;
  open_task_count: number;
  overdue_task_count: number;
};

/**
 * List deals visible to the given user. Agents see their own deals; TC and
 * admin see all.
 */
export async function listDealsForUser(
  userId: string,
  isTCOrAdmin: boolean
): Promise<DealWithStats[]> {
  const filter = isTCOrAdmin
    ? Prisma.sql``
    : Prisma.sql`WHERE deals.agent_id = ${userId}::uuid`;

  return prisma.$queryRaw<DealWithStats[]>`
    SELECT deals.id, deals.agent_id, deals.type::text AS type, deals.stage::text AS stage,
           ${healthExpr} AS health,
           deals.title, deals.address, deals.price::text AS price, deals.arive_linked,
           deals.arive_milestones, deals.arive_key_dates, deals.arive_loan_status,
           deals.fee_status, deals.fee_amount_cents, deals.fee_paid_at,
           deals.fast_pass, deals.smooth_exit,
           deals.pre_approved, deals.baa_signed, deals.commission_pct::text AS commission_pct,
           deals.created_at, deals.updated_at,
           u.name AS agent_name, u.email AS agent_email, u.phone AS agent_phone,
           (SELECT COUNT(*) FROM tasks t
            WHERE t.deal_id = deals.id AND t.status NOT IN ('completed','skipped'))::int AS open_task_count,
           (SELECT COUNT(*) FROM tasks t
            WHERE t.deal_id = deals.id AND t.status NOT IN ('completed','skipped')
              AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE)::int AS overdue_task_count
    FROM deals
    JOIN users u ON u.id = deals.agent_id
    ${filter}
    ORDER BY deals.updated_at DESC
  `;
}

/**
 * Get a single deal owned by the given agent.
 */
export async function getDealForAgent(
  dealId: string,
  agentId: string
): Promise<DealRow | null> {
  const rows = await prisma.$queryRaw<DealRow[]>`
    SELECT id, agent_id, type::text AS type, stage::text AS stage,
           ${healthExpr} AS health,
           title, address, price::text AS price, arive_linked,
           arive_loan_id, arive_milestones, arive_key_dates, arive_loan_status, arive_synced_at,
           notes, fee_status, fee_amount_cents, fee_paid_at,
           fast_pass, smooth_exit, pre_approved, baa_signed,
           commission_pct::text AS commission_pct,
           created_at, updated_at
    FROM deals
    WHERE id = ${dealId}::uuid AND agent_id = ${agentId}::uuid
  `;
  return rows[0] ?? null;
}

/**
 * Resolve whether a user has access to a deal — agent owner or participant.
 */
export async function hasDealAccess(
  dealId: string,
  userId: string
): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM deals
      WHERE id = ${dealId}::uuid AND (
        agent_id = ${userId}::uuid OR
        EXISTS (
          SELECT 1 FROM deal_participants
          WHERE deal_id = ${dealId}::uuid AND user_id = ${userId}::uuid
        )
      )
    ) AS ok
  `;
  return rows[0]?.ok ?? false;
}
