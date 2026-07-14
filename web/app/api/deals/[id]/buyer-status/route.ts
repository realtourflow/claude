import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { isBuyerStatus } from "@/lib/buyer-status";
import { buyerStatusPatchBodySchema } from "@/lib/schemas/deal";
import { parseBody } from "@/lib/schemas/parse";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/deals/[id]/buyer-status (#184)
 *
 * Sets the client-facing "Buyer's Progress" status the seller portal shows.
 * Owning-agent only (same pattern as the flags route): buyer status is a
 * client-facing deal-state change, so — like stage changes (#167 policy) —
 * linked TCs, admins, and participants cannot set it. Participants read it
 * through GET /api/me/deals and GET /api/deals/[id].
 *
 * Body: { buyer_status: string | null } — must be one of the canonical
 * steps in lib/buyer-status.ts; null or "" clears it.
 */
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;

  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    // Schema-validated (#88): non-string/non-null buyer_status 400s in the
    // parse; the canonical-step check below keeps its own message.
    const parsed = await parseBody(req, buyerStatusPatchBodySchema);
    if (!parsed.ok) return parsed.response;

    const raw = parsed.data.buyer_status;
    const value = raw ? raw.trim() : "";
    if (value !== "" && !isBuyerStatus(value)) {
      return error("invalid buyer_status", 400);
    }

    // Owner-scoped update: 404 (not 403) so strangers can't probe deal ids.
    const result = await prisma.deals.updateMany({
      where: { id: dealId, agent_id: userId },
      data: { buyer_status: value === "" ? null : value, updated_at: new Date() },
    });
    if (result.count === 0) return error("deal not found", 404);

    return json({ ok: true, buyer_status: value === "" ? null : value });
  })) as Response;
}
