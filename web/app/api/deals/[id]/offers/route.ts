import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { hasDealAccess } from "@/lib/deals";
import { createOfferBodySchema } from "@/lib/schemas/offer";
import { parseBody } from "@/lib/schemas/parse";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    if (!(await hasDealAccess(dealId, userId))) return error("deal not found", 404);
    const offers = await prisma.offers.findMany({
      where: { deal_id: dealId },
      orderBy: { submitted_at: "desc" },
    });
    return json(offers);
  })) as Response;
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    const owned = await prisma.deals.findFirst({
      where: { id: dealId, agent_id: userId },
      select: { id: true },
    });
    if (!owned) return error("deal not found", 404);

    // Schema-validated (#88): a stringly offer_price / bad close_date /
    // non-array contingencies 400 here — they used to 500 inside Prisma.
    const parsed = await parseBody(req, createOfferBodySchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const offer = await prisma.offers.create({
      data: {
        deal_id: dealId,
        buyer_name: body.buyer_name ?? "",
        offer_price: body.offer_price ?? 0,
        close_date: body.close_date ? new Date(body.close_date) : null,
        contingencies: body.contingencies ?? [],
        agent_notes: body.agent_notes ?? "",
      },
    });
    return json(offer, 201);
  })) as Response;
}
