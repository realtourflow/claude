/**
 * Task due-date helpers (#187).
 *
 * - `isValidDueDateString` — strict `YYYY-MM-DD` validation shared by the
 *   task create/edit routes (a bad string would otherwise blow up the
 *   `::date` cast in Postgres and surface as a 500).
 * - `autoTaskDueDate` — stage-relative default due date for stage-advance
 *   auto-tasks, so the overdue/health/calendar machinery has real data.
 */

const DUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True when `s` is a real calendar date in strict `YYYY-MM-DD` form. */
export function isValidDueDateString(s: string): boolean {
  if (!DUE_DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Base due-date offset (days after entering the stage) for auto-generated
 * tasks. Values reflect real transaction urgency: offers move in days,
 * search/contract phases in a week, closing-day items are due tomorrow.
 */
const STAGE_DUE_BASE_DAYS: Record<string, number> = {
  active_search: 7,
  offer_active: 2,
  under_contract: 7,
  pre_close: 3,
  closing: 1,
  post_close: 7,
};

const DEFAULT_BASE_DAYS = 7;

/**
 * Default due date (`YYYY-MM-DD`, local calendar) for an auto-task created on
 * entering `stage`: stage base offset, halved for high priority (min 1 day),
 * doubled for low priority.
 */
export function autoTaskDueDate(
  stage: string,
  priority: string,
  from: Date = new Date()
): string {
  const base = STAGE_DUE_BASE_DAYS[stage] ?? DEFAULT_BASE_DAYS;
  const days =
    priority === "high"
      ? Math.max(1, Math.ceil(base / 2))
      : priority === "low"
        ? base * 2
        : base;
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
