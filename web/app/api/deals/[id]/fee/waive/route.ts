import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { logAudit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(
    req,
    async (claims): Promise<Response> => {
      const result = await prisma.deals.updateMany({
        where: { id: dealId },
        data: { fee_status: "waived" },
      });
      if (result.count === 0) return error("deal not found", 404);
      const actorId = await resolveUserId(claims.sub);
      logAudit({
        actorId: actorId ?? undefined,
        eventType: "fee_waive",
        dealId,
      });
      return json({ status: "waived" });
    },
    { allowedRoles: ["admin", "tc"] }
  )) as Response;
}
