import { json, withAuth, error } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { randomBytes } from "node:crypto";

export async function GET(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);

    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { calendar_token: true },
    });
    let token = user?.calendar_token;
    if (!token) {
      token = randomBytes(24).toString("hex");
      await prisma.users.update({
        where: { id: userId },
        data: { calendar_token: token },
      });
    }
    const url = new URL(req.url);
    const base = `${url.protocol}//${url.host}`;
    const feed_url = `${base}/api/calendar/${token}/feed.ics`;
    // Calendar apps subscribe via the webcal:// scheme (the OS hands the URL
    // to the default calendar app), which they resolve back over http(s).
    const webcal_url = feed_url.replace(/^https?:\/\//, "webcal://");
    // feed_url/webcal_url are the live contract CalendarPage reads (#298);
    // url/token are kept for backward compatibility with older callers.
    return json({ feed_url, webcal_url, url: feed_url, token });
  })) as Response;
}
