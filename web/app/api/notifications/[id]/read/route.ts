import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id: notifId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);

    const result = await prisma.notifications.updateMany({
      where: { id: notifId, user_id: userId, read_at: null },
      data: { read_at: new Date() },
    });
    if (result.count === 0) return error("not found", 404);
    return json({ ok: true });
  })) as Response;
}
