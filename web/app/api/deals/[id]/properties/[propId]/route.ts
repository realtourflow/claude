import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";

type Ctx = { params: Promise<{ id: string; propId: string }> };

type PatchBody = {
  status?: string;
  thumbnail_url?: string;
  buyer_note?: string | null;
  agent_private_note?: string | null;
  offer_requested?: boolean;
};

async function ownedByAgent(dealId: string, userId: string): Promise<boolean> {
  const d = await prisma.deals.findFirst({
    where: { id: dealId, agent_id: userId },
    select: { id: true },
  });
  return !!d;
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId, propId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    if (!(await ownedByAgent(dealId, userId))) return error("deal not found", 404);

    let body: PatchBody;
    try {
      body = (await req.json()) as PatchBody;
    } catch {
      return error("invalid request body", 400);
    }
    const data: {
      status?: string;
      thumbnail_url?: string;
      buyer_note?: string | null;
      agent_private_note?: string | null;
      offer_requested?: boolean;
    } = {};
    if (typeof body.status === "string") data.status = body.status;
    if (typeof body.thumbnail_url === "string") data.thumbnail_url = body.thumbnail_url;
    if (body.buyer_note !== undefined) data.buyer_note = body.buyer_note;
    if (body.agent_private_note !== undefined)
      data.agent_private_note = body.agent_private_note;
    if (typeof body.offer_requested === "boolean")
      data.offer_requested = body.offer_requested;

    const result = await prisma.tracked_properties.updateMany({
      where: { id: propId, deal_id: dealId },
      data,
    });
    if (result.count === 0) return error("not found", 404);
    return json({ ok: true });
  })) as Response;
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId, propId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    if (!(await ownedByAgent(dealId, userId))) return error("deal not found", 404);
    await prisma.tracked_properties.deleteMany({
      where: { id: propId, deal_id: dealId },
    });
    return new Response(null, { status: 204 });
  })) as Response;
}
