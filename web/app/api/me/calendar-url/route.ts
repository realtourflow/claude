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
    return json({ url: `${base}/api/calendar/${token}/feed.ics`, token });
  })) as Response;
}
