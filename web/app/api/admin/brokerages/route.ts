import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/roles";

// GET /api/admin/brokerages?status=pending|active|rejected|all — the company
// review queue. "Other" entries agents typed during onboarding land here as
// pending for the admin to approve into the dropdown (or reject).
export async function GET(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    if (!hasRole(claims.roles, ["admin"])) return error("forbidden", 403);

    const status = new URL(req.url).searchParams.get("status") ?? "pending";
    const rows = await prisma.brokerages.findMany({
      where: status === "all" ? {} : { status },
      select: {
        id: true,
        name: true,
        status: true,
        created_at: true,
        users: { select: { name: true, email: true } },
      },
      orderBy: { created_at: "desc" },
    });
    return json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        created_at: r.created_at.toISOString(),
        suggested_by_name: r.users?.name ?? null,
        suggested_by_email: r.users?.email ?? null,
      }))
    );
  })) as Response;
}
