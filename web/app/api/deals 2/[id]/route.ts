import { error, json, withAuth } from "@/lib/http";
import { resolveUserId } from "@/lib/users";
import { getDealForAgent } from "@/lib/deals";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    const deal = await getDealForAgent(id, userId);
    if (!deal) return error("deal not found", 404);
    return json(deal);
  })) as Response;
}
