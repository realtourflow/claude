import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/roles";

type Ctx = { params: Promise<{ id: string }> };

type ActionBody = { action?: "approve" | "reject" };

// POST /api/admin/brokerages/[id] — review a pending company suggestion.
// approve → it joins the active dropdown for future agents; reject → it stays
// out (the suggesting agent keeps the name on their own profile either way).
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    if (!hasRole(claims.roles, ["admin"])) return error("forbidden", 403);

    let body: ActionBody;
    try {
      body = (await req.json()) as ActionBody;
    } catch {
      return error("action is required", 400);
    }
    if (body.action !== "approve" && body.action !== "reject") {
      return error("action must be approve or reject", 400);
    }

    const row = await prisma.brokerages.findUnique({
      where: { id },
      select: { id: true, name: true, status: true },
    });
    if (!row) return error("suggestion not found", 404);
    if (row.status !== "pending") {
      return error("this suggestion has already been reviewed", 409);
    }

    // The UNIQUE(name) index is case-sensitive — block approving a case-variant
    // of a company that's already in the dropdown (near-duplicate entries).
    if (body.action === "approve") {
      const collision = await prisma.brokerages.findFirst({
        where: {
          id: { not: row.id },
          status: "active",
          name: { equals: row.name, mode: "insensitive" },
        },
        select: { name: true },
      });
      if (collision) {
        return error(
          `"${collision.name}" is already in the list — reject this suggestion instead`,
          409
        );
      }
    }

    const status = body.action === "approve" ? "active" : "rejected";
    await prisma.brokerages.update({ where: { id }, data: { status } });
    return json({ id, status });
  })) as Response;
}
