import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { getAriveClient } from "@/lib/arive";

type Ctx = { params: Promise<{ id: string }> };

type LinkBody = { arive_loan_id?: string };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    let body: LinkBody;
    try {
      body = (await req.json()) as LinkBody;
    } catch {
      return error("arive_loan_id is required", 400);
    }
    if (!body.arive_loan_id) {
      return error("arive_loan_id is required", 400);
    }

    const deal = await prisma.deals.findUnique({
      where: { id: dealId },
      select: { agent_id: true },
    });
    if (!deal) return error("deal not found", 404);
    if (deal.agent_id !== userId) return error("forbidden", 403);

    await prisma.deals.update({
      where: { id: dealId },
      data: { arive_loan_id: body.arive_loan_id, arive_linked: true },
    });

    // Best-effort initial sync — AWAITED (T15, #83): a detached promise may
    // never run on Vercel once the response is sent. A sync failure is
    // swallowed and never fails the link itself.
    try {
      const client = getAriveClient();
      if (client.enabled()) {
        const loan = await client.fetchLoan(body.arive_loan_id);
        await prisma.deals.update({
          where: { id: dealId },
          data: {
            arive_loan_status: loan.status,
            arive_milestones: loan.milestones as never,
            arive_key_dates: loan.keyDates as never,
            arive_synced_at: new Date(),
          },
        });
      }
    } catch (err) {
      console.error("arive initial sync failed", err);
    }

    return json({ ok: true });
  })) as Response;
}
