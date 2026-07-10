/**
 * Shared ARIVE key-date selection (#196).
 *
 * ARIVE stores a deal's closing under `estimatedFundingDate`, falling back to
 * `closingContingency` — the same COALESCE the legacy Go handler used. Every
 * consumer of `deals.arive_key_dates` (the calendar push in lib/jobs.ts, the
 * iCal feed route, and the deal serializer in hooks/useDeals.ts) must read the
 * date through this helper so they can't drift onto different keys again.
 *
 * Pure module: no server-only imports — it is shared by client hooks too.
 */

/**
 * Picks the closing date out of a raw `arive_key_dates` JSON value.
 * Returns the trimmed date string, or null when absent/blank/malformed.
 */
export function extractClosingDate(keyDates: unknown): string | null {
  if (!keyDates || typeof keyDates !== "object") return null;
  const kd = keyDates as Record<string, unknown>;
  const v = kd.estimatedFundingDate ?? kd.closingContingency;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * Parses a key-date string. Accepts "2026-09-15" (treated as UTC midnight to
 * avoid TZ drift) or a full RFC3339 timestamp. Returns null when unparseable.
 */
export function parseDateOnly(s: string): Date | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
