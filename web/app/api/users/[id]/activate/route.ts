import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { resolveUserId } from "@/lib/users";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  return (await withAuth(
    req,
    async (claims): Promise<Response> => {
      const result = await prisma.users.updateMany({
        where: { id },
        data: { deactivated_at: null },
      });
      if (result.count === 0) {
        return error("user not found", 404);
      }
      const actorId = await resolveUserId(claims.sub);
      await logAudit({
        actorId: actorId ?? undefined,
        eventType: "user_activate",
        targetId: id,
      });
      return json({ ok: true });
    },
    { allowedRoles: ["admin"] }
  )) as Response;
}
