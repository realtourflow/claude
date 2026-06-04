/**
 * Calendar push hooks called from deal/task mutation handlers.
 *
 * Execution model (important): callers `await` these inside a try/catch — NOT
 * detached fire-and-forget. On Vercel a function can freeze once the response
 * is sent, so a detached promise may never run. The Google call is ~200-500ms;
 * awaiting is reliable, and a missed push self-heals on the next advance
 * because the upsert patches the same event. (No pg-boss in v1.)
 */
import { prisma } from "./db";
import { fanOutUpsert, type CalendarEvent } from "./calendar";

/**
 * Pushes the deal's closing-day event (UID `close-<dealId>`) into the agent's
 * connected calendar(s). Best-effort: no closing date or no connected calendar
 * → no-op (zero HTTP calls). Mirrors pushDealClosingEvent in
 * backend/internal/handlers/calendar_events.go.
 */
export async function enqueuePushDealClosingEvent(dealId: string): Promise<void> {
  const deal = await prisma.deals.findUnique({
    where: { id: dealId },
    select: { agent_id: true, title: true, address: true, arive_key_dates: true },
  });
  if (!deal) return;

  const closing = extractClosingDate(deal.arive_key_dates);
  if (!closing) return; // no known closing date → no-op (delete-on-clear is T5a-2)
  const day = parseClosingDate(closing);
  if (!day) return;

  const event: CalendarEvent = {
    internalUid: `close-${dealId}`,
    summary: `Closing — ${deal.title}`,
    description: `RealTourFlow closing day for ${deal.title}`,
    location: deal.address ?? "",
    start: day,
    end: new Date(day.getTime() + 24 * 60 * 60 * 1000), // exclusive all-day end
    allDay: true,
  };
  await fanOutUpsert(deal.agent_id, event);
}

// Task-due events are wired in T5a-2.
export function enqueuePushTaskDueEvent(taskId: string): void {
  void taskId;
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
function parseClosingDate(s: string): Date | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
