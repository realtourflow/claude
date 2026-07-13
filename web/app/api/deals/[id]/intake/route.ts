import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/deals/[id]/intake — the persisted onboarding questionnaire for a
// deal (#175). Readable by the deal's agent or any deal participant (same
// access rule as the participants route); everyone else gets 404.
export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    const deal = await prisma.deals.findFirst({
      where: {
        id: dealId,
        OR: [
          { agent_id: userId },
          { deal_participants: { some: { user_id: userId } } },
        ],
      },
      select: { intake: true },
    });
    if (!deal) return error("deal not found", 404);

    return json({ intake: deal.intake ?? null });
  })) as Response;
}
