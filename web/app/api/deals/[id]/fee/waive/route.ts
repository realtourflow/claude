import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { isLinkedTCForDeal } from "@/lib/deals";
import { logAudit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Statuses a waive may overwrite. Never 'paid' (revenue must not be silently
 * erased) and never 'waived' (idempotent re-waives are rejected like the
 * checkout route's already-settled 409). Values from migration 000014.
 */
const WAIVABLE_FEE_STATUSES = ["unpaid", "pending"] as const;

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(
    req,
    async (claims): Promise<Response> => {
      const actorId = await resolveUserId(claims.sub);

      // Existence first so a missing deal stays 404 for authorized roles.
      const deal = await prisma.deals.findUnique({
        where: { id: dealId },
        select: { id: true },
      });
      if (!deal) return error("deal not found", 404);

      // Tenant scoping (#180): admins are global; a TC may only waive on
      // deals whose agent has them assigned (users.tc_user_id = caller).
      const isAdmin = claims.roles.includes("admin");
      if (!isAdmin) {
        if (!actorId || !(await isLinkedTCForDeal(dealId, actorId))) {
          return error("forbidden", 403);
        }
      }

      // Status guard (#180): the condition lives in the UPDATE itself so a
      // concurrent payment can't be overwritten between check and write.
      const result = await prisma.deals.updateMany({
        where: { id: dealId, fee_status: { in: [...WAIVABLE_FEE_STATUSES] } },
        data: { fee_status: "waived" },
      });
      if (result.count === 0) {
        return error("fee is not waivable (already paid or waived)", 409);
      }

      // Awaited so the audit row is committed before we respond (never throws).
      await logAudit({
        actorId: actorId ?? undefined,
        eventType: "fee_waive",
        dealId,
      });
      return json({ status: "waived" });
    },
    { allowedRoles: ["admin", "tc"] }
  )) as Response;
}
