import { prisma } from "@/lib/db";
import { getAriveClient } from "@/lib/arive";
import { enqueuePushDealClosingEvent } from "@/lib/jobs";

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

  // Sync inline and AWAIT it before acking (T15, #83). The old version
  // detached this block to 200 fast, but on Vercel the function can freeze
  // once the response is sent — the webhook could ack and never sync. ARIVE
  // tolerates a slow ack, so awaiting is safe and far simpler than widening
  // the pg-boss queue (lib/queue.ts is purpose-built for calendar-push jobs;
  // an arive-sync job kind would pollute its payload union or need a second
  // queue + cron wiring). Failures are still swallowed so the webhook 200s
  // either way — same contract as before; the calendar push leg is durable on
  // its own (enqueuePushDealClosingEvent records a pg-boss job that the cron
  // sweep retries).
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

    // Calendar push (closing event) for every deal tied to this loan — same
    // best-effort contract as the sync route. Swallow per-deal so one failure
    // can't block another.
    const affected = await prisma.deals.findMany({
      where: { arive_loan_id: loanId },
      select: { id: true },
    });
    for (const d of affected) {
      try {
        await enqueuePushDealClosingEvent(d.id);
      } catch (err) {
        console.error("calendar push (closing event) failed", {
          dealId: d.id,
          err,
        });
      }
    }
  } catch (err) {
    console.error("arive webhook sync failed", { loanId, err });
  }

  return new Response(null, { status: 200 });
}
