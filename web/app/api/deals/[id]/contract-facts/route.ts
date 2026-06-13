import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { ContractDataError, upsertFacts } from "@/lib/contract-facts";

type Ctx = { params: Promise<{ id: string }> };

// PUT /api/deals/[id]/contract-facts — upsert the deal's shared contract
// facts (purchase price, earnest money, key dates...). Owner-agent only.
export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    const owned = await prisma.deals.findFirst({
      where: { id: dealId, agent_id: userId },
      select: { id: true },
    });
    if (!owned) return error("deal not found or access denied", 404);

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return error("invalid request body", 400);
    }

    try {
      await upsertFacts(dealId, body);
    } catch (err) {
      if (err instanceof ContractDataError) return error(err.message, 400);
      throw err;
    }
    return json({ ok: true });
  })) as Response;
}
