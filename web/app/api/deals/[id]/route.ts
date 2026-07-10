import { error, json, withAuth } from "@/lib/http";
import { resolveUserId } from "@/lib/users";
import { canReadDeal, getDealById } from "@/lib/deals";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    // Read access (#167): owning agent, deal participant, the agent's linked
    // TC (users.tc_user_id), or admin. 404 (not 403) so strangers can't probe
    // which deal ids exist.
    if (!(await canReadDeal(id, userId, claims.roles))) {
      return error("deal not found", 404);
    }
    const deal = await getDealById(id);
    if (!deal) return error("deal not found", 404);
    return json(deal);
  })) as Response;
}
