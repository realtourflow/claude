import { error, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const { id: offerId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    // Only the deal's agent may delete an offer.
    const offer = await prisma.offers.findUnique({
      where: { id: offerId },
      select: { deals: { select: { agent_id: true } } },
    });
    if (!offer || offer.deals.agent_id !== userId) {
      return error("offer not found", 404);
    }
    await prisma.offers.delete({ where: { id: offerId } });
    return new Response(null, { status: 204 });
  })) as Response;
}
