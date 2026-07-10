import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { getDealForAgent } from "@/lib/deals";
import {
  STAGE_LABELS,
  type DealStage,
  isForwardAdvance,
} from "@/lib/stages";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications";
import { enqueuePushDealClosingEvent } from "@/lib/jobs";
import { seedStandardContingencies } from "@/lib/contingency-seed";

type Ctx = { params: Promise<{ id: string }> };

type AdvanceBody = { stage?: string };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";

  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    let body: AdvanceBody;
    try {
      body = (await req.json()) as AdvanceBody;
    } catch {
      return error("invalid request body", 400);
    }
    const newStage = body.stage as DealStage | undefined;
    if (!newStage) return error("stage is required", 400);

    // Look up current stage + ownership.
    const current = await prisma.deals.findFirst({
      where: { id: dealId, agent_id: userId },
      select: { stage: true },
    });
    if (!current) return error("deal not found", 404);

    // Blocking-task gate (skipped on force).
    if (!force && isForwardAdvance(current.stage, newStage)) {
      const blocking = await prisma.tasks.findMany({
        where: {
          deal_id: dealId,
          priority: "high",
          status: { not: "completed" },
          OR: [{ stage_context: current.stage }, { stage_context: null }],
        },
        select: { id: true, title: true },
      });
      if (blocking.length > 0) {
        return json(
          { gate: true, blocking_tasks: blocking },
          422
        );
      }
    }

    // Transaction: update stage + insert history row.
    await prisma.$transaction([
      prisma.deals.update({
        where: { id: dealId },
        data: { stage: newStage, updated_at: new Date() },
      }),
      prisma.deal_stage_history.create({
        data: {
          deal_id: dealId,
          from_stage: current.stage,
          to_stage: newStage,
          changed_by: userId,
        },
      }),
    ]);

    // Auto-seed the standard inspection/financing/appraisal contingencies the
    // first time a deal goes under contract (#186). Best-effort: idempotent in
    // the lib (only when the deal has zero contingencies), and a failure here
    // must never fail the stage change.
    if (newStage === "under_contract") {
      try {
        await seedStandardContingencies(dealId);
      } catch (err) {
        console.error("contingency auto-seed failed", err);
      }
    }

    // Side-effect fan-out (audit + notifications + calendar push) is AWAITED,
    // not detached: on Vercel the function can freeze once the response is
    // sent, so a stray promise may never run. Each piece is best-effort —
    // logAudit/createNotification swallow internally; the participant lookup
    // is wrapped here — so nothing below can fail the stage change.
    await logAudit({
      actorId: userId,
      eventType: "stage_change",
      dealId,
      metadata: { from_stage: current.stage, to_stage: newStage },
    });

    try {
      const participants = await prisma.deal_participants.findMany({
        where: { deal_id: dealId },
        select: { user_id: true },
      });
      const label = STAGE_LABELS[newStage] ?? newStage;
      for (const p of participants) {
        await createNotification({
          userId: p.user_id,
          title: "Your deal has moved forward",
          body: `New stage: ${label}`,
          kind: "stage_change",
          dealId,
        });
      }
    } catch (err) {
      console.error("stage notification fan-out failed", err);
    }

    // Calendar push is best-effort but must be AWAITED, not detached: on Vercel
    // the function can freeze after the response is sent, killing a stray
    // promise. Swallow errors so a calendar hiccup never fails the advance.
    try {
      await enqueuePushDealClosingEvent(dealId);
    } catch (err) {
      console.error("calendar push (closing event) failed", err);
    }

    // Re-fetch with computed health.
    const fresh = await getDealForAgent(dealId, userId);
    return json(fresh);
  })) as Response;
}
