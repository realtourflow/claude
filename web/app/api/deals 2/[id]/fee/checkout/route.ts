import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { createCheckoutSession } from "@/lib/stripe";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    const deal = await prisma.deals.findUnique({
      where: { id: dealId },
      select: { agent_id: true, fee_status: true, title: true },
    });
    if (!deal) return error("deal not found", 404);
    if (deal.agent_id !== userId) return error("forbidden", 403);
    if (deal.fee_status === "paid" || deal.fee_status === "waived") {
      return error("fee already settled", 409);
    }

    const url = new URL(req.url);
    const origin = `${url.protocol}//${url.host}`;
    const session = await createCheckoutSession({
      dealId,
      dealTitle: deal.title,
      successUrl: `${origin}/agent/deals/${dealId}?fee=paid`,
      cancelUrl: `${origin}/agent/deals/${dealId}?fee=cancelled`,
    });

    await prisma.deals.update({
      where: { id: dealId },
      data: { fee_status: "pending", fee_checkout_session_id: session.id },
    });
    return json({ checkout_url: session.url });
  })) as Response;
}
