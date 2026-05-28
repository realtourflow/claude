import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";

export async function POST(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);

    await prisma.notifications.updateMany({
      where: { user_id: userId, read_at: null },
      data: { read_at: new Date() },
    });
    return json({ ok: true });
  })) as Response;
}
