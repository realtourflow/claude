import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";

type Ctx = { params: Promise<{ id: string }> };

type FlagsBody = {
  pre_approved?: boolean;
  baa_signed?: boolean;
};

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;

  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    let body: FlagsBody;
    try {
      body = (await req.json()) as FlagsBody;
    } catch {
      return error("invalid request body", 400);
    }

    const data: { pre_approved?: boolean; baa_signed?: boolean; updated_at: Date } = {
      updated_at: new Date(),
    };
    if (typeof body.pre_approved === "boolean") data.pre_approved = body.pre_approved;
    if (typeof body.baa_signed === "boolean") data.baa_signed = body.baa_signed;

    const result = await prisma.deals.updateMany({
      where: { id: dealId, agent_id: userId },
      data,
    });
    if (result.count === 0) return error("deal not found", 404);

    return json({ ok: true });
  })) as Response;
}
