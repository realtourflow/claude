import { json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";

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

      const rows = await prisma.$queryRaw<
        {
          id: string;
          actor_id: string | null;
          actor_name: string | null;
          event_type: string;
          deal_id: string | null;
          target_id: string | null;
          metadata: unknown;
          created_at: Date;
        }[]
      >`
        SELECT a.id, a.actor_id, u.name AS actor_name,
               a.event_type, a.deal_id, a.target_id,
               a.metadata, a.created_at
        FROM audit_log a
        LEFT JOIN users u ON u.id = a.actor_id
        ORDER BY a.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      return json(
        rows.map((r) => ({
          ...r,
          created_at: r.created_at.toISOString(),
        }))
      );
    },
    { allowedRoles: ["admin"] }
  )) as Response;
}
