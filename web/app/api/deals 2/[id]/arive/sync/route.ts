import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { getAriveClient } from "@/lib/arive";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    const deal = await prisma.deals.findUnique({
      where: { id: dealId },
      select: { agent_id: true, arive_loan_id: true },
    });
    if (!deal) return error("deal not found", 404);
    if (deal.agent_id !== userId) return error("forbidden", 403);
    if (!deal.arive_loan_id) return error("deal not linked to ARIVE", 400);

    const client = getAriveClient();
    if (!client.enabled()) return error("arive not configured", 503);
    const loan = await client.fetchLoan(deal.arive_loan_id);
    await prisma.deals.update({
      where: { id: dealId },
      data: {
        arive_loan_status: loan.status,
        arive_milestones: loan.milestones as never,
        arive_key_dates: loan.keyDates as never,
        arive_synced_at: new Date(),
      },
    });
    return json({ ok: true, synced_at: new Date().toISOString() });
  })) as Response;
}
