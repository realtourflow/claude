import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";

// Disconnect the user's Google Calendar. Drops the OAuth token row and the
// associated calendar_event_map entries (so future pushes don't try to
// update events with a revoked token).
export async function DELETE(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);
    await prisma.oauth_tokens.deleteMany({
      where: { user_id: userId, provider: "google_calendar" },
    });
    await prisma.calendar_event_map.deleteMany({
      where: { user_id: userId, provider: "google_calendar" },
    });
    return json({ ok: true });
  })) as Response;
}
