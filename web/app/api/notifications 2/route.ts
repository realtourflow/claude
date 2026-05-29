import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";

export async function GET(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);

    const rows = await prisma.$queryRaw<
      {
        id: string;
        title: string;
        body: string | null;
        type: string;
        deal_id: string | null;
        href: string | null;
        read: boolean;
        created_at: Date;
      }[]
    >`
      SELECT id, title, body, type, deal_id, href,
             (read_at IS NOT NULL) AS read,
             created_at
      FROM notifications
      WHERE user_id = ${userId}::uuid
      ORDER BY (read_at IS NOT NULL), created_at DESC
      LIMIT 50
    `;
    return json(
      rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }))
    );
  })) as Response;
}
