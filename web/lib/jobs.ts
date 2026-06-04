/**
 * Calendar push hooks called from deal/task mutation handlers.
 *
 * Execution model (important): callers `await` these inside a try/catch — NOT
 * detached fire-and-forget. On Vercel a function can freeze once the response
 * is sent, so a detached promise may never run. The Google call is ~200-500ms;
 * awaiting is reliable, and a missed push self-heals on the next mutation
 * because the upsert patches the same event. (No pg-boss in v1.)
 *
 * Mirrors pushDealClosingEvent / pushTaskDueEvent in
 * backend/internal/handlers/calendar_events.go.
 */
import { prisma } from "./db";
import { fanOutUpsert, fanOutDelete, type CalendarEvent } from "./calendar";

/**
 * Pushes the deal's closing-day event (UID `close-<dealId>`). When the closing
 * date is absent (cleared), removes any previously pushed event instead.
 */
export async function enqueuePushDealClosingEvent(dealId: string): Promise<void> {
  const deal = await prisma.deals.findUnique({
    where: { id: dealId },
    select: { agent_id: true, title: true, address: true, arive_key_dates: true },
  });
  if (!deal) return;

  const uid = `close-${dealId}`;
  const closing = extractClosingDate(deal.arive_key_dates);
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
 * delete the event instead.
 */
export async function enqueuePushTaskDueEvent(taskId: string): Promise<void> {
  const task = await prisma.tasks.findUnique({
    where: { id: taskId },
    select: {
      title: true,
      due_date: true,
      status: true,
      deals: { select: { agent_id: true, title: true } },
    },
  });
  if (!task) return;

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

// The closing date comes from ARIVE: prefer the estimated funding date, fall
// back to the closing contingency — same COALESCE the Go handler uses.
function extractClosingDate(keyDates: unknown): string | null {
  if (!keyDates || typeof keyDates !== "object") return null;
  const kd = keyDates as Record<string, unknown>;
  const v = kd.estimatedFundingDate ?? kd.closingContingency;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

// Accepts "2026-09-15" (treated as UTC midnight to avoid TZ drift) or RFC3339.
function parseDateOnly(s: string): Date | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Normalizes a DateTime (task.due_date is @db.Date) to UTC midnight of that day.
function dateOnly(d: Date): Date {
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00Z`);
}

function addDay(d: Date): Date {
  return new Date(d.getTime() + 24 * 60 * 60 * 1000);
}
