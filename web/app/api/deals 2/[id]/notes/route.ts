import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { hasRole } from "@/lib/roles";

type Ctx = { params: Promise<{ id: string }> };

type NotesBody = { notes?: string };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;

  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);

    const allowed = hasRole(claims.roles, ["agent", "tc", "admin"]);
    if (!allowed) return error("forbidden", 403);

    // Agents must own the deal.
    if (hasRole(claims.roles, ["agent"])) {
      const deal = await prisma.deals.findFirst({
        where: { id: dealId, agent_id: userId },
        select: { id: true },
      });
      if (!deal) return error("forbidden", 403);
    }

    let body: NotesBody;
    try {
      body = (await req.json()) as NotesBody;
    } catch {
      return error("invalid request body", 400);
    }

    await prisma.deals.update({
      where: { id: dealId },
      data: { notes: body.notes ?? "", updated_at: new Date() },
    });

    return json({ ok: true });
  })) as Response;
}
