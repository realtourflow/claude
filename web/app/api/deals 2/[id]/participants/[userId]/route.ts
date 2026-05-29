import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";

type Ctx = { params: Promise<{ id: string; userId: string }> };

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId, userId: participantId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    const deal = await prisma.deals.findFirst({
      where: { id: dealId, agent_id: userId },
      select: { id: true },
    });
    if (!deal) return error("deal not found", 404);

    await prisma.deal_participants.deleteMany({
      where: { deal_id: dealId, user_id: participantId },
    });
    return json({ status: "ok" });
  })) as Response;
}
