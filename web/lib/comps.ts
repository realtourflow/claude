/**
 * Comparable-sales analysis (#374). Pure, deterministic, server-side — no AI.
 *
 * Given closed MLS sales and a subject property, pick the comparable ones and
 * derive a price RANGE. Deliberately explainable: every number here can be
 * traced back to specific sales, which matters because the output is shown to
 * an agent who may have to defend it.
 *
 * Product decisions baked in (Paul, 2026-07-23):
 * - Match on same city + beds ±1 + sqft ±20%, closed in the last 6 months.
 * - When that's too thin, WIDEN automatically up the tier ladder and report how
 *   far it had to go (`tier_used` / `widened`) rather than silently returning a
 *   range built from almost nothing.
 * - Output a RANGE only — never a single "this is the price" number — always
 *   carrying the not-an-appraisal disclaimer.
 */

/** A closed sale from the MLS, normalized off the SimplyRETS payload. */
export type CompCandidate = {
  mlsId: string;
  address: string;
  city: string;
  /** Actual sale price. Candidates without a real one are dropped. */
  closePrice: number;
  /** ISO date (YYYY-MM-DD) the sale closed. */
  closeDate: string;
  beds: number;
  baths: number;
  sqft: number;
};

/** The property being priced. */
export type CompSubject = {
  city: string;
  beds: number;
  baths: number;
  sqft: number;
};

export type CompAnalysis = {
  comps: CompCandidate[];
  range: { low: number; high: number } | null;
  basis: "price_per_sqft" | "close_price" | null;
  median_price_per_sqft: number | null;
  tier_used: string | null;
  /** True when the tightest tier was too thin and the match had to be relaxed. */
  widened: boolean;
  /** `no_comps` | `insufficient_comps`, else null. */
  reason: string | null;
  disclaimer: string;
};

export const COMP_DISCLAIMER =
  "Estimated from recent comparable sales in the MLS. This is not an appraisal, " +
  "a broker price opinion, or a guarantee of value.";

/** Below this many matches we refuse to publish a range. */
export const MIN_COMPS = 3;

/** Cap on comps returned/used, most recent first — keeps payloads bounded. */
export const MAX_COMPS = 10;

type CompTier = {
  label: string;
  monthsBack: number;
  bedsDelta: number;
  /** Fractional sqft tolerance, e.g. 0.2 → ±20%. */
  sqftPct: number;
};

/**
 * The widening ladder. Each rung is a strict superset of the one before, so
 * match counts only ever grow as we descend — the loop can stop at the first
 * rung that clears MIN_COMPS.
 */
export const COMP_TIERS: readonly CompTier[] = [
  { label: "sold 6mo, beds ±1, sqft ±20%", monthsBack: 6, bedsDelta: 1, sqftPct: 0.2 },
  { label: "sold 12mo, beds ±1, sqft ±20%", monthsBack: 12, bedsDelta: 1, sqftPct: 0.2 },
  { label: "sold 12mo, beds ±1, sqft ±35%", monthsBack: 12, bedsDelta: 1, sqftPct: 0.35 },
  { label: "sold 12mo, beds ±2, sqft ±50%", monthsBack: 12, bedsDelta: 2, sqftPct: 0.5 },
];

/**
 * Linear-interpolated percentile over an ASCENDING-sorted array.
 * p is a fraction (0.25 = 25th percentile).
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function normCity(s: string): string {
  return s.trim().toLowerCase();
}

function monthsAgo(now: Date, months: number): Date {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

function roundToThousand(v: number): number {
  return Math.round(v / 1000) * 1000;
}

/**
 * Whether a candidate qualifies at the given tier. The subject's beds/sqft are
 * only used as constraints when we actually know them — a subject with unknown
 * size must not filter every comp out (it falls back to a close-price basis).
 */
function matchesTier(
  c: CompCandidate,
  subject: CompSubject,
  tier: CompTier,
  cutoff: Date
): boolean {
  if (normCity(c.city) !== normCity(subject.city)) return false;

  if (subject.beds > 0 && c.beds > 0) {
    if (Math.abs(c.beds - subject.beds) > tier.bedsDelta) return false;
  }
  if (subject.sqft > 0 && c.sqft > 0) {
    const lo = subject.sqft * (1 - tier.sqftPct);
    const hi = subject.sqft * (1 + tier.sqftPct);
    if (c.sqft < lo || c.sqft > hi) return false;
  }

  const closed = new Date(c.closeDate);
  if (Number.isNaN(closed.getTime())) return false;
  return closed >= cutoff;
}

/**
 * Derive the range. Price-per-sqft is preferred because it normalizes for size
 * — a 20%-larger comp shouldn't drag the estimate up on its own. Falls back to
 * raw close prices when neither the subject nor the comps carry usable sqft.
 */
function buildRange(comps: CompCandidate[], subject: CompSubject) {
  if (subject.sqft > 0) {
    const ppsf = comps
      .filter((c) => c.sqft > 0)
      .map((c) => c.closePrice / c.sqft)
      .sort((a, b) => a - b);
    if (ppsf.length > 0) {
      return {
        range: {
          low: roundToThousand(percentile(ppsf, 0.25) * subject.sqft),
          high: roundToThousand(percentile(ppsf, 0.75) * subject.sqft),
        },
        basis: "price_per_sqft" as const,
        median_price_per_sqft: Math.round(percentile(ppsf, 0.5) * 100) / 100,
      };
    }
  }
  const prices = comps.map((c) => c.closePrice).sort((a, b) => a - b);
  return {
    range: {
      low: roundToThousand(percentile(prices, 0.25)),
      high: roundToThousand(percentile(prices, 0.75)),
    },
    basis: "close_price" as const,
    median_price_per_sqft: null,
  };
}

/**
 * Select comps and compute the range, widening automatically until at least
 * MIN_COMPS qualify. `now` is injectable so the date window is testable.
 */
export function analyzeComps(
  candidates: CompCandidate[],
  subject: CompSubject,
  now: Date = new Date()
): CompAnalysis {
  // A sale with no real price can't anchor anything.
  const priced = candidates.filter((c) => c.closePrice > 0);

  let selected: CompCandidate[] = [];
  let tierIndex = 0;
  for (let i = 0; i < COMP_TIERS.length; i++) {
    const tier = COMP_TIERS[i];
    const cutoff = monthsAgo(now, tier.monthsBack);
    selected = priced.filter((c) => matchesTier(c, subject, tier, cutoff));
    tierIndex = i;
    if (selected.length >= MIN_COMPS) break;
  }

  const tierUsed = COMP_TIERS[tierIndex].label;
  const widened = tierIndex > 0;

  // Most recent first, then capped.
  const ordered = [...selected]
    .sort((a, b) => new Date(b.closeDate).getTime() - new Date(a.closeDate).getTime())
    .slice(0, MAX_COMPS);

  const base = {
    tier_used: tierUsed,
    widened,
    disclaimer: COMP_DISCLAIMER,
  };

  if (ordered.length === 0) {
    return {
      ...base,
      comps: [],
      range: null,
      basis: null,
      median_price_per_sqft: null,
      reason: "no_comps",
    };
  }
  if (ordered.length < MIN_COMPS) {
    // Found something, but too thin to publish a defensible range.
    return {
      ...base,
      comps: ordered,
      range: null,
      basis: null,
      median_price_per_sqft: null,
      reason: "insufficient_comps",
    };
  }

  const { range, basis, median_price_per_sqft } = buildRange(ordered, subject);
  return { ...base, comps: ordered, range, basis, median_price_per_sqft, reason: null };
}
