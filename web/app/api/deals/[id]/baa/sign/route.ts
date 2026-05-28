import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { hasDealAccess } from "@/lib/deals";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;

  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    const access = await hasDealAccess(dealId, userId);
    if (!access) return error("deal not found", 404);

    await prisma.deals.update({
      where: { id: dealId },
      data: { baa_signed: true, updated_at: new Date() },
    });

    return json({ ok: true });
  })) as Response;
}
