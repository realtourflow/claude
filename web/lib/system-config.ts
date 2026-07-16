import { prisma } from "./db";

/**
 * Per-stage "days in stage before a deal is considered stuck" thresholds. These
 * feed the deal-health CASE (see `healthExpr` in lib/deals.ts). Admins override
 * them from the System Config page (PUT /api/admin/config →
 * system_config.config.stage_thresholds).
 */
export type StageThresholds = {
  intake: number;
  active_search: number;
  offer_active: number;
  under_contract: number;
  pre_close: number;
  closing: number;
  post_close: number;
};

/**
 * The shipped defaults — the exact per-stage day counts the health CASE was
 * hard-coded with (ported from the legacy Go backend). Used verbatim whenever
 * System Config has no saved override: no config row, no `stage_thresholds`
 * key, or a partial/garbage value for a given stage. This is the safety net
 * that keeps the common (no-config) path byte-for-byte unchanged.
 *
 * Keep in lockstep with DEFAULT_CONFIG.stage_thresholds in the admin UI
 * (components/pages/admin/AdminDashboard.tsx).
 */
export const DEFAULT_STAGE_THRESHOLDS: StageThresholds = {
  intake: 5,
  active_search: 30,
  offer_active: 10,
  under_contract: 35,
  pre_close: 10,
  closing: 5,
  post_close: 21,
};

const STAGE_KEYS = Object.keys(
  DEFAULT_STAGE_THRESHOLDS
) as (keyof StageThresholds)[];

/**
 * Coerce one saved threshold to a safe positive integer of "days", or fall back
 * to the default. Guards the raw SQL against anything non-numeric, non-finite,
 * negative, or zero ever reaching it — thresholds are day counts, so only a
 * finite value >= 1 is meaningful. (Values are bound as query parameters, not
 * interpolated, so this is a sanity floor, not an injection defense.)
 */
function coerceThreshold(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n)) return fallback;
  const days = Math.floor(n);
  return days >= 1 ? days : fallback;
}

/**
 * Read the live per-stage health thresholds from system_config, merging each
 * stage over DEFAULT_STAGE_THRESHOLDS (per-key fallback for any missing/invalid
 * entry). Returns the full defaults when no config row exists.
 *
 * Call this ONCE per request and pass the result into `healthExpr(...)`. Never
 * call it per deal row — the health expression runs inside a correlated
 * subquery for every listed deal, and re-reading config there would be an N+1.
 */
export async function getStageThresholds(): Promise<StageThresholds> {
  const row = await prisma.system_config.findUnique({
    where: { id: 1 },
    select: { config: true },
  });
  const cfg = (row?.config ?? {}) as Record<string, unknown>;
  const raw = (cfg.stage_thresholds ?? {}) as Record<string, unknown>;
  const out = {} as StageThresholds;
  for (const key of STAGE_KEYS) {
    out[key] = coerceThreshold(raw[key], DEFAULT_STAGE_THRESHOLDS[key]);
  }
  return out;
}
