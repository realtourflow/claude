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
    const row = await prisma.deals.findUnique({
      where: { id: dealId },
      select: { showing_availability: true },
    });
    return json(row?.showing_availability ?? null);
  })) as Response;
}

export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    if (!(await hasDealAccess(dealId, userId))) return error("deal not found", 404);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return error("invalid JSON", 400);
    }
    await prisma.deals.update({
      where: { id: dealId },
      data: { showing_availability: body as never, updated_at: new Date() },
    });
    return json({ ok: true });
  })) as Response;
}
