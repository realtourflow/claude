import { prisma } from "@/lib/db";
import { error, json, withAuth } from "@/lib/http";
import { resolveUserId } from "@/lib/users";
import { canReadDeal } from "@/lib/deals";

type Ctx = { params: Promise<{ id: string }> };

type StageHistoryRow = {
  from_stage: string | null;
  to_stage: string;
  changed_at: Date;
  changed_by: string;
};

/**
 * GET /api/deals/[id]/stage-history (#256).
 *
 * Returns the deal's ordered stage-transition log so the Timeline tab can
 * derive real per-stage durations from `deal_stage_history` (written on every
 * advance/retreat) instead of the retired mock DEAL_STAGE_DAYS table.
 *
 * Read access mirrors GET /api/deals/[id] exactly (#167): owning agent, deal
 * participant, the agent's linked TC, or admin. 404 (not 403) on no access so
 * strangers can't probe which deal ids exist. Read-only — the stage route
 * (PATCH .../stage) is the sole writer.
 */
export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    if (!(await canReadDeal(dealId, userId, claims.roles))) {
      return error("deal not found", 404);
    }

    const rows = await prisma.$queryRaw<StageHistoryRow[]>`
      SELECT from_stage::text AS from_stage,
             to_stage::text AS to_stage,
             changed_at,
             changed_by
      FROM deal_stage_history
      WHERE deal_id = ${dealId}::uuid
      ORDER BY changed_at ASC
    `;
    return json(rows);
  })) as Response;
}
