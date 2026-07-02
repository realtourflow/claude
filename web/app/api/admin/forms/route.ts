import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/roles";

type Row = {
  id: string;
  label: string;
  side: string;
  status: string;
  source_file_name: string;
  agent_name: string;
  created_at: Date;
  field_count: number;
  needs_review_count: number;
};

function serialize(r: Row) {
  return {
    id: r.id,
    label: r.label,
    side: r.side,
    status: r.status,
    source_file_name: r.source_file_name,
    agent_name: r.agent_name,
    created_at: r.created_at.toISOString(),
    field_count: Number(r.field_count),
    needs_review_count: Number(r.needs_review_count),
  };
}

// GET /api/admin/forms?status=pending_review|ready|rejected|all — the review
// queue across all agents. Admin only. Defaults to the pending-review queue.
export async function GET(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    if (!hasRole(claims.roles, ["admin"])) return error("forbidden", 403);

    const status = new URL(req.url).searchParams.get("status") ?? "pending_review";
    const base = `
      SELECT f.id, f.label, f.side, f.status, f.source_file_name, f.created_at,
             u.name AS agent_name,
             COUNT(ff.id)::int AS field_count,
             COUNT(ff.id) FILTER (WHERE ff.needs_review)::int AS needs_review_count
      FROM uploaded_forms f
      JOIN users u ON u.id = f.agent_id
      LEFT JOIN uploaded_form_fields ff ON ff.form_id = f.id`;
    const tail = "GROUP BY f.id, u.name ORDER BY f.created_at DESC LIMIT 200";

    const rows =
      status === "all"
        ? await prisma.$queryRawUnsafe<Row[]>(`${base} ${tail}`)
        : status === "pending_review"
          ? // The pending queue also surfaces bundles awaiting a page-split.
            await prisma.$queryRawUnsafe<Row[]>(
              `${base} WHERE f.status IN ('pending_review', 'pending_split') ${tail}`
            )
          : await prisma.$queryRawUnsafe<Row[]>(
              `${base} WHERE f.status = $1 ${tail}`,
              status
            );

    return json(rows.map(serialize));
  })) as Response;
}
