import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";

type Ctx = { params: Promise<{ id: string }> };

type CommissionBody = { commission_pct?: number };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;

  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    let body: CommissionBody;
    try {
      body = (await req.json()) as CommissionBody;
    } catch {
      return error("invalid request body", 400);
    }

    const pct = typeof body.commission_pct === "number" ? body.commission_pct : NaN;
    if (!(pct > 0 && pct <= 20)) {
      return error("commission_pct must be between 0 and 20", 400);
    }

    const result = await prisma.deals.updateMany({
      where: { id: dealId, agent_id: userId },
      data: { commission_pct: pct, updated_at: new Date() },
    });
    if (result.count === 0) return error("deal not found", 404);

    return json({ commission_pct: pct });
  })) as Response;
}
