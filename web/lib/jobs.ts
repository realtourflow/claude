/**
 * Calendar push hooks called from deal/task mutation handlers.
 *
 * Execution model (FF4, #22): **enqueue durable job → attempt inline → cron
 * sweeps failures.**
 *
 * - `enqueuePushDealClosingEvent` / `enqueuePushTaskDueEvent` keep their
 *   pre-queue signatures — call sites (deal stage, task create/status routes)
 *   `await` them inside try/catch, unchanged.
 * - Each call first inserts a pg-boss job (the durability record), then runs
 *   the push inline so mutation-path latency and the real-time behavior stay
 *   exactly as before. Inline success CONSUMES the job (`completeCalendarJob`)
 *   so the sweep won't re-push; inline failure is swallowed and the job stays
 *   queued for `processCalendarJobs` (Vercel Cron → /api/jobs/process) to
 *   retry with backoff.
 * - The inline attempt is awaited, not detached: on Vercel a function can
 *   freeze once the response is sent, so a detached promise may never run.
 *
 * `processDealClosingPush` / `processTaskDuePush` are the pure processors
 * (resolve entity → fan out; THROW on provider failure so pg-boss can retry).
 * The queue worker dispatches to them directly.
 *
 * Mirrors pushDealClosingEvent / pushTaskDueEvent in
 * the legacy Go backend.
 */
import { parseDateOnly, resolveClosingDate } from "./arive-dates";
import { prisma } from "./db";
import { fanOutUpsert, fanOutDelete, type CalendarEvent } from "./calendar";
import {
  completeCalendarJob,
  enqueueCalendarJob,
  type CalendarJobPayload,
} from "./queue";

/**
 * Pushes the deal's closing-day event (UID `close-<dealId>`). When the closing
 * date is absent (cleared), removes any previously pushed event instead.
 * Throws when any connected provider write fails (the queue retries on throw).
 */
export async function processDealClosingPush(dealId: string): Promise<void> {
  const deal = await prisma.deals.findUnique({
    where: { id: dealId },
    select: {
      agent_id: true,
      title: true,
      address: true,
      arive_key_dates: true,
      closing_date: true,
    },
  });
  if (!deal) return; // deal deleted since enqueue → nothing to push

  const uid = `close-${dealId}`;
  // ARIVE key date wins, else the agent-entered manual closing_date — same
  // precedence as the iCal feed and the deal serializer (#253/#300).
  const closing = resolveClosingDate(deal.arive_key_dates, deal.closing_date);
  if (!closing) {
    // Date cleared → delete the event if one was previously pushed.
    await fanOutDelete(deal.agent_id, uid);
    return;
  }
  const day = parseDateOnly(closing);
  if (!day) return; // unparseable → leave any existing event alone (mirror Go)

  const event: CalendarEvent = {
    internalUid: uid,
    summary: `Closing — ${deal.title}`,
    description: `RealTourFlow closing day for ${deal.title}`,
    location: deal.address ?? "",
    start: day,
    end: addDay(day), // exclusive all-day end
    allDay: true,
  };
  await fanOutUpsert(deal.agent_id, event);
}

/**
 * Pushes a task's due-date event (UID `task-<taskId>`). Tasks with no due date,
 * or that are completed/skipped, should NOT have a calendar entry — those
 * delete the event instead. Throws on provider failure (queue retries).
 */
export async function processTaskDuePush(taskId: string): Promise<void> {
  const task = await prisma.tasks.findUnique({
    where: { id: taskId },
    select: {
      title: true,
      due_date: true,
      status: true,
      deals: { select: { agent_id: true, title: true } },
    },
  });
  if (!task) return; // task deleted since enqueue → nothing to push

  const agentId = task.deals.agent_id;
  const uid = `task-${taskId}`;
  if (!task.due_date || task.status === "completed" || task.status === "skipped") {
    await fanOutDelete(agentId, uid);
    return;
  }

  const day = dateOnly(task.due_date);
  const event: CalendarEvent = {
    internalUid: uid,
    summary: `${task.title} — ${task.deals.title}`,
    description: "RealTourFlow task deadline",
    start: day,
    end: addDay(day),
    allDay: true,
  };
  await fanOutUpsert(agentId, event);
}

/** Durable push for a deal's closing event. Signature unchanged from v1. */
export async function enqueuePushDealClosingEvent(dealId: string): Promise<void> {
  await enqueueThenAttemptInline({ kind: "deal-closing", id: dealId }, () =>
    processDealClosingPush(dealId)
  );
}

/** Durable push for a task's due-date event. Signature unchanged from v1. */
export async function enqueuePushTaskDueEvent(taskId: string): Promise<void> {
  await enqueueThenAttemptInline({ kind: "task-due", id: taskId }, () =>
    processTaskDuePush(taskId)
  );
}

/**
 * The enqueue-then-inline core:
 *
 * 1. Insert the durable job. If even that fails (DB hiccup), fall back to a
 *    plain inline push — i.e. degrade to the pre-queue behavior, never worse.
 * 2. Run the push inline. Failure with a job recorded → swallow; the job stays
 *    queued/retryable and the cron sweep delivers it later.
 * 3. Inline success → consume the job so the sweep doesn't double-push. If the
 *    consume itself fails, the sweep re-pushes once — harmless, the upsert
 *    PATCHes the same external event (calendar_event_map idempotency).
 */
async function enqueueThenAttemptInline(
  payload: CalendarJobPayload,
  attempt: () => Promise<void>
): Promise<void> {
  let jobId: string | null = null;
  try {
    jobId = await enqueueCalendarJob(payload);
  } catch (err) {
    console.error(`calendar enqueue failed for ${payload.kind} ${payload.id}; inline-only push`, err);
  }

  try {
    await attempt();
  } catch (err) {
    if (jobId) {
      console.error(
        `inline calendar push failed for ${payload.kind} ${payload.id}; job ${jobId} left queued for the cron sweep`,
        err
      );
      return;
    }
    throw err; // no durable job to fall back on — surface to the caller's try/catch
  }

  if (jobId) {
    try {
      await completeCalendarJob(jobId);
    } catch (err) {
      console.error(
        `calendar job ${jobId} pushed inline but could not be marked complete; the sweep may re-push (idempotent)`,
        err
      );
    }
  }
}

// extractClosingDate / parseDateOnly moved to ./arive-dates so the calendar
// push, the iCal feed, and the deal serializer share one key selection (#196).

// Normalizes a DateTime (task.due_date is @db.Date) to UTC midnight of that day.
function dateOnly(d: Date): Date {
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00Z`);
}

function addDay(d: Date): Date {
  return new Date(d.getTime() + 24 * 60 * 60 * 1000);
}
