import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";

export async function DELETE(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);
    await prisma.oauth_tokens.deleteMany({
      where: { user_id: userId, provider: "microsoft_calendar" },
    });
    await prisma.calendar_event_map.deleteMany({
      where: { user_id: userId, provider: "microsoft_calendar" },
    });
    return json({ ok: true });
  })) as Response;
}
