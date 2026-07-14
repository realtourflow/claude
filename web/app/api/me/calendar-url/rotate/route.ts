import { json, withAuth, error } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { randomBytes } from "node:crypto";

// POST /api/me/calendar-url/rotate
//
// Regenerates the caller's `calendar_token`, immediately invalidating the
// previous iCal feed URL: the public feed route matches on `calendar_token`, so
// once the column changes the old `webcal://.../feed.ics` link 404s. This is the
// revoke/rotate control for a leaked feed URL (issue #297).
//
// Rotation requires the agent's own Auth0 session (`withAuth`) — it can never be
// triggered through the unauthenticated public feed URL.
export async function POST(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);

    const token = randomBytes(24).toString("hex");
    await prisma.users.update({
      where: { id: userId },
      data: { calendar_token: token },
    });

    const url = new URL(req.url);
    const base = `${url.protocol}//${url.host}`;
    const feed_url = `${base}/api/calendar/${token}/feed.ics`;
    const webcal_url = `webcal://${url.host}/api/calendar/${token}/feed.ics`;
    // `url` mirrors the GET route's original field for backward compatibility;
    // `feed_url`/`webcal_url` are what the calendar UI renders.
    return json({ feed_url, webcal_url, url: feed_url, token });
  })) as Response;
}
