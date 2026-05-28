import { prisma } from "@/lib/db";
import { getAriveClient } from "@/lib/arive";

type Payload = {
  loanId?: string;
  loan_id?: string;
  event?: string;
};

export async function POST(req: Request): Promise<Response> {
  const client = getAriveClient();
  if (!client.enabled()) {
    return new Response("arive not configured", { status: 503 });
  }
  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return new Response("invalid payload", { status: 400 });
  }
  const loanId = payload.loanId ?? payload.loan_id ?? "";
  if (!loanId) return new Response("missing loanId", { status: 400 });

  // Acknowledge immediately — ARIVE expects a fast 200. Sync runs in the
  // background and never blocks the webhook response.
  void (async () => {
    try {
      const loan = await client.fetchLoan(loanId);
      await prisma.deals.updateMany({
        where: { arive_loan_id: loanId },
        data: {
          arive_loan_status: loan.status,
          arive_milestones: loan.milestones as never,
          arive_key_dates: loan.keyDates as never,
          arive_synced_at: new Date(),
        },
      });
    } catch (err) {
      console.error("arive webhook sync failed", { loanId, err });
    }
  })();

  return new Response(null, { status: 200 });
}
