/**
 * Task due-date helpers (#187).
 *
 * - `isValidDueDateString` — strict `YYYY-MM-DD` validation shared by the
 *   task create/edit routes (a bad string would otherwise blow up the
 *   `::date` cast in Postgres and surface as a 500).
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
