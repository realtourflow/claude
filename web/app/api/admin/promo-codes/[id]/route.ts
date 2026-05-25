import { error, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { logAudit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const { id: codeId } = await ctx.params;
  return (await withAuth(
    req,
    async (claims): Promise<Response> => {
      const result = await prisma.promo_codes.deleteMany({ where: { id: codeId } });
      if (result.count === 0) return error("not found", 404);
      const actorId = await resolveUserId(claims.sub);
      logAudit({
        actorId: actorId ?? undefined,
        eventType: "promo_delete",
        targetId: codeId,
      });
      return new Response(null, { status: 204 });
    },
    { allowedRoles: ["admin"] }
  )) as Response;
}
