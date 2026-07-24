/**
 * Comparable-sales analysis (#374). Pure, deterministic, server-side — no AI.
 *
 * Given closed MLS sales and a subject property, pick the comparable ones and
 * derive a price RANGE. Deliberately explainable: every number here can be
 * traced back to specific sales, which matters because the output is shown to
 * an agent who may have to defend it.
 *
 * Product decisions baked in (Paul, 2026-07-23):
 * - Match on beds ±1 + sqft ±20%, closed in the last 6 months, scoped to the
 *   subject's POSTAL CODE when we know it (same-ZIP is the tightest tier) and
 *   otherwise the subject's city. SimplyRETS has no radius search, so ZIP is the
 *   finest geography available — it keeps a big city from mixing neighborhoods.
 * - When a tier is too thin, WIDEN automatically (ZIP→city, 6mo→12mo, then the
 *   size band) and report how far it went (`tier_used` / `widened`) rather than
 *   quietly building a range from two sales.
 * - Reject statistical OUTLIERS (a single wildly-off sale) via a Tukey IQR fence
 *   before ranging — but only with enough comps to detect them and never so
 *   aggressively that it starves the range below MIN_COMPS.
 * - Output a RANGE only — never a single "this is the price" number — always
 *   carrying the not-an-appraisal disclaimer.
 */

/** A closed sale from the MLS, normalized off the SimplyRETS payload. */
export type CompCandidate = {
  mlsId: string;
  address: string;
  city: string;
  /** ZIP (5-digit or ZIP+4); "" when the feed omits it. */
  postalCode: string;
  /** Actual sale price. Candidates without a real one are dropped. */
  closePrice: number;
  /** ISO date (YYYY-MM-DD) the sale closed. */
  closeDate: string;
  beds: number;
  baths: number;
  sqft: number;
};

/** The property being priced. `postalCode` is optional — city is the fallback. */
export type CompSubject = {
  city: string;
  postalCode?: string;
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
  /** True when the tightest available tier was too thin and had to be relaxed. */
  widened: boolean;
  /** How many statistical outliers the IQR fence dropped before ranging. */
  outliers_removed: number;
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

/**
 * Outlier rejection needs enough points to be meaningful — a Tukey fence over
 * 3–4 values is noise. Below this, we keep every comp.
 */
export const OUTLIER_MIN_COMPS = 5;

type CompScope = "postal" | "city";

type CompTier = {
  label: string;
  scope: CompScope;
  monthsBack: number;
  bedsDelta: number;
  /** Fractional sqft tolerance, e.g. 0.2 → ±20%. */
  sqftPct: number;
};

/**
 * The widening ladder, tightest first. Postal-scoped rungs only apply when the
 * subject has a known ZIP (they're filtered out otherwise, so a subject with no
 * ZIP behaves exactly as city-scoped comps always did). Each city rung is a
 * superset of the one before, so match counts only grow as we descend.
 */
export const COMP_TIERS: readonly CompTier[] = [
  { label: "same ZIP, sold 6mo, beds ±1, sqft ±20%", scope: "postal", monthsBack: 6, bedsDelta: 1, sqftPct: 0.2 },
  { label: "same city, sold 6mo, beds ±1, sqft ±20%", scope: "city", monthsBack: 6, bedsDelta: 1, sqftPct: 0.2 },
  { label: "same city, sold 12mo, beds ±1, sqft ±20%", scope: "city", monthsBack: 12, bedsDelta: 1, sqftPct: 0.2 },
  { label: "same city, sold 12mo, beds ±1, sqft ±35%", scope: "city", monthsBack: 12, bedsDelta: 1, sqftPct: 0.35 },
  { label: "same city, sold 12mo, beds ±2, sqft ±50%", scope: "city", monthsBack: 12, bedsDelta: 2, sqftPct: 0.5 },
];

/** The loosest tier — used to bracket the single MLS fetch that feeds the ladder. */
export const WIDEST_TIER = COMP_TIERS[COMP_TIERS.length - 1];

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

/** Tukey [Q1 − 1.5·IQR, Q3 + 1.5·IQR] fence over an unsorted sample. */
export function tukeyFence(values: number[]): { lo: number; hi: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = q3 - q1;
  return { lo: q1 - 1.5 * iqr, hi: q3 + 1.5 * iqr };
}

/** The 5-digit ZIP at the END of an address ("... AL 35244" / "...-1234"), else "". */
export function extractPostalCode(address: string): string {
  const m = address.match(/(\d{5})(?:-\d{4})?\s*$/);
  return m ? m[1] : "";
}

function normCity(s: string): string {
  return s.trim().toLowerCase();
}

/** First 5-digit run of a postal string (drops the +4), else "". */
function normPostal(s: string): string {
  const m = s.match(/\d{5}/);
  return m ? m[0] : "";
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
  if (tier.scope === "postal") {
    if (!subject.postalCode) return false;
    if (normPostal(c.postalCode) !== subject.postalCode) return false;
  } else if (normCity(c.city) !== normCity(subject.city)) {
    return false;
  }

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

/** Per-comp figure the range is built on, given the chosen basis. */
function metricOf(c: CompCandidate, basis: "price_per_sqft" | "close_price"): number {
  return basis === "price_per_sqft" ? c.closePrice / c.sqft : c.closePrice;
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

  // Postal rungs only make sense when we know the subject's ZIP.
  const tiers = COMP_TIERS.filter(
    (t) => t.scope === "city" || !!subject.postalCode
  );

  let selected: CompCandidate[] = [];
  let localIndex = 0;
  for (let i = 0; i < tiers.length; i++) {
    const cutoff = monthsAgo(now, tiers[i].monthsBack);
    selected = priced.filter((c) => matchesTier(c, subject, tiers[i], cutoff));
    localIndex = i;
    if (selected.length >= MIN_COMPS) break;
  }

  const tierUsed = tiers[localIndex].label;
  const widened = localIndex > 0;

  // Most recent first, then capped to the relevant window.
  const pool = [...selected]
    .sort((a, b) => new Date(b.closeDate).getTime() - new Date(a.closeDate).getTime())
    .slice(0, MAX_COMPS);

  const base = { tier_used: tierUsed, widened, disclaimer: COMP_DISCLAIMER };

  if (pool.length === 0) {
    return {
      ...base,
      comps: [],
      range: null,
      basis: null,
      median_price_per_sqft: null,
      outliers_removed: 0,
      reason: "no_comps",
    };
  }

  // Price-per-sqft normalizes for size, but only when enough comps carry sqft;
  // otherwise range on raw close prices over the whole pool.
  const basis: "price_per_sqft" | "close_price" =
    subject.sqft > 0 && pool.filter((c) => c.sqft > 0).length >= MIN_COMPS
      ? "price_per_sqft"
      : "close_price";
  const usable = basis === "price_per_sqft" ? pool.filter((c) => c.sqft > 0) : pool;

  if (usable.length < MIN_COMPS) {
    // Found something, but too thin to publish a defensible range.
    return {
      ...base,
      comps: pool,
      range: null,
      basis: null,
      median_price_per_sqft: null,
      outliers_removed: 0,
      reason: "insufficient_comps",
    };
  }

  // Reject outliers via a Tukey fence — but never into insufficiency, and only
  // with enough points for the fence to mean anything.
  let kept = usable;
  let outliersRemoved = 0;
  if (usable.length >= OUTLIER_MIN_COMPS) {
    const { lo, hi } = tukeyFence(usable.map((c) => metricOf(c, basis)));
    const within = usable.filter((c) => {
      const m = metricOf(c, basis);
      return m >= lo && m <= hi;
    });
    if (within.length >= MIN_COMPS && within.length < usable.length) {
      kept = within;
      outliersRemoved = usable.length - within.length;
    }
  }

  const metrics = kept.map((c) => metricOf(c, basis)).sort((a, b) => a - b);
  const p25 = percentile(metrics, 0.25);
  const p75 = percentile(metrics, 0.75);

  const range =
    basis === "price_per_sqft"
      ? { low: roundToThousand(p25 * subject.sqft), high: roundToThousand(p75 * subject.sqft) }
      : { low: roundToThousand(p25), high: roundToThousand(p75) };
  const median_price_per_sqft =
    basis === "price_per_sqft"
      ? Math.round(percentile(metrics, 0.5) * 100) / 100
      : null;

  return {
    ...base,
    comps: kept,
    range,
    basis,
    median_price_per_sqft,
    outliers_removed: outliersRemoved,
    reason: null,
  };
}
