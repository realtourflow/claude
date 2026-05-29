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
      const result = await prisma.$executeRaw`
        UPDATE users
        SET deactivated_at = NOW()
        WHERE id = ${id}::uuid AND deactivated_at IS NULL
      `;
      if (result === 0) {
        return error("user not found or already deactivated", 404);
      }
      const actorId = await resolveUserId(claims.sub);
      logAudit({
        actorId: actorId ?? undefined,
        eventType: "user_deactivate",
        targetId: id,
      });
      return json({ ok: true });
    },
    { allowedRoles: ["admin"] }
  )) as Response;
}
