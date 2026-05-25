import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { hasDealAccess } from "@/lib/deals";

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

type CreateBody = {
  buyer_name?: string;
  offer_price?: number;
  close_date?: string;
  contingencies?: string[];
  agent_notes?: string;
};

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

    let body: CreateBody;
    try {
      body = (await req.json()) as CreateBody;
    } catch {
      return error("invalid request body", 400);
    }
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
