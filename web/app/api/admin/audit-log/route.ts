import { Prisma } from "@/app/generated/prisma/client";
import { json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";

type AuditRow = {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  event_type: string;
  deal_id: string | null;
  deal_title: string | null;
  target_id: string | null;
  metadata: unknown;
  created_at: Date;
};

export async function GET(req: Request): Promise<Response> {
  return (await withAuth(
    req,
    async (): Promise<Response> => {
      const url = new URL(req.url);
      const limit = Math.min(
        Math.max(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 1),
        500
      );
      const offset = Math.max(
        parseInt(url.searchParams.get("offset") ?? "0", 10) || 0,
        0
      );
      // Optional filter — narrows both the page and the total count.
      const eventType = url.searchParams.get("event_type")?.trim() || null;
      const where = eventType
        ? Prisma.sql`WHERE a.event_type = ${eventType}`
        : Prisma.sql``;

      const rows = await prisma.$queryRaw<AuditRow[]>`
        SELECT a.id, a.actor_id, u.name AS actor_name, u.email AS actor_email,
               a.event_type, a.deal_id, d.title AS deal_title, a.target_id,
               a.metadata, a.created_at
        FROM audit_log a
        LEFT JOIN users u ON u.id = a.actor_id
        LEFT JOIN deals d ON d.id = a.deal_id
        ${where}
        ORDER BY a.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      // Total matching rows (ignores limit/offset) so the UI can page/count.
      const totals = await prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM audit_log a
        ${where}
      `;
      const total = totals[0]?.count ?? 0;

      return json({
        entries: rows.map((r) => ({
          ...r,
          created_at: r.created_at.toISOString(),
        })),
        total,
      });
    },
    { allowedRoles: ["admin"] }
  )) as Response;
}
