import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { hasDealAccess } from "@/lib/deals";
import { serializeVendor } from "@/lib/vendors";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/deals/:id/vendors — the owning agent's Preferred Vendors, readable by
 * anyone with deal access (buyers/sellers in a client portal). This is the
 * client-facing read: `/api/vendors` is scoped to the JWT caller's own list, so
 * a buyer/seller hitting it gets their (always-empty) list and the portal's
 * "Agent's Preferred Vendors" card silently never renders (#265). Ordering and
 * serialization mirror `/api/vendors` exactly.
 */
export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    // 404 (not 403) so a non-participant can't distinguish a real deal from a
    // fake one — no cross-tenant vendor-list leak.
    if (!(await hasDealAccess(dealId, userId))) return error("deal not found", 404);

    const deal = await prisma.deals.findUnique({
      where: { id: dealId },
      select: { agent_id: true },
    });
    if (!deal) return error("deal not found", 404);

    const rows = await prisma.preferred_vendors.findMany({
      where: { agent_id: deal.agent_id },
      orderBy: [{ category: "asc" }, { sort_order: "asc" }, { created_at: "asc" }],
    });
    return json(rows.map(serializeVendor));
  })) as Response;
}
