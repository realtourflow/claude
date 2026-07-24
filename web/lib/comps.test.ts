import { describe, it, expect } from "vitest";
import {
  analyzeComps,
  percentile,
  COMP_DISCLAIMER,
  MIN_COMPS,
  type CompCandidate,
  type CompSubject,
} from "./comps";

const NOW = new Date("2026-07-01T00:00:00Z");

function subject(overrides: Partial<CompSubject> = {}): CompSubject {
  return { city: "Hoover", beds: 3, baths: 2, sqft: 2000, ...overrides };
}

/**
 * A closed sale. Defaults land inside the tightest tier (same city, beds 3,
 * 2000 sqft, one month ago) so each test can move ONE dimension out of range.
 */
function comp(overrides: Partial<CompCandidate> = {}): CompCandidate {
  return {
    mlsId: "m1",
    address: "1 Test St",
    city: "Hoover",
    closePrice: 240000,
    closeDate: "2026-06-01",
    beds: 3,
    baths: 2,
    sqft: 2000,
    ...overrides,
  };
}

/** Five comps at $100–140/sqft (2000 sqft each) → p25 = 110, p75 = 130. */
function fiveComps(): CompCandidate[] {
  return [200000, 220000, 240000, 260000, 280000].map((closePrice, i) =>
    comp({ mlsId: `m${i}`, closePrice })
  );
}

describe("percentile", () => {
  it("returns exact values on index hits", () => {
    const sorted = [100, 110, 120, 130, 140];
    expect(percentile(sorted, 0.25)).toBe(110);
    expect(percentile(sorted, 0.75)).toBe(130);
    expect(percentile(sorted, 0.5)).toBe(120);
  });

  it("interpolates between neighbours", () => {
    // idx = 3 * 0.5 = 1.5 → halfway between 110 and 120.
    expect(percentile([100, 110, 120, 130], 0.5)).toBe(115);
  });

  it("handles a single value", () => {
    expect(percentile([250], 0.25)).toBe(250);
  });
});

describe("analyzeComps — price range", () => {
  it("computes a p25–p75 range on a price-per-sqft basis", () => {
    const res = analyzeComps(fiveComps(), subject(), NOW);

    expect(res.basis).toBe("price_per_sqft");
    // p25 $110/sqft × 2000 = 220k ; p75 $130/sqft × 2000 = 260k
    expect(res.range).toEqual({ low: 220000, high: 260000 });
    expect(res.median_price_per_sqft).toBe(120);
    expect(res.comps).toHaveLength(5);
    expect(res.reason).toBeNull();
  });

  it("scales the range to the subject's size, not the comps'", () => {
    // Same $/sqft comps, but a 3000 sqft subject → 1.5x the range.
    const res = analyzeComps(fiveComps(), subject({ sqft: 3000 }), NOW);
    // 3000 is outside ±20% of the 2000 sqft comps, so it widens — but the
    // scaling is what matters here.
    expect(res.range).toEqual({ low: 330000, high: 390000 });
  });

  it("falls back to a close-price basis when the subject has no sqft", () => {
    const res = analyzeComps(fiveComps(), subject({ sqft: 0 }), NOW);

    expect(res.basis).toBe("close_price");
    // p25/p75 of the raw close prices.
    expect(res.range).toEqual({ low: 220000, high: 260000 });
    expect(res.median_price_per_sqft).toBeNull();
  });

  it("rounds the range to the nearest $1,000", () => {
    const comps = [
      comp({ mlsId: "a", closePrice: 201234 }),
      comp({ mlsId: "b", closePrice: 224567 }),
      comp({ mlsId: "c", closePrice: 249876 }),
      comp({ mlsId: "d", closePrice: 261111 }),
      comp({ mlsId: "e", closePrice: 283333 }),
    ];
    const res = analyzeComps(comps, subject(), NOW);
    expect(res.range!.low % 1000).toBe(0);
    expect(res.range!.high % 1000).toBe(0);
  });

  it("always carries the not-an-appraisal disclaimer", () => {
    const res = analyzeComps(fiveComps(), subject(), NOW);
    expect(res.disclaimer).toBe(COMP_DISCLAIMER);
    expect(res.disclaimer.toLowerCase()).toContain("not an appraisal");
  });
});

describe("analyzeComps — matching rules", () => {
  it("excludes comps in a different city", () => {
    const comps = [...fiveComps(), comp({ mlsId: "far", city: "Vestavia Hills" })];
    const res = analyzeComps(comps, subject(), NOW);
    expect(res.comps.map((c) => c.mlsId)).not.toContain("far");
  });

  it("excludes comps outside the bedroom tolerance", () => {
    // Tier 1 allows beds ±1 → a 6-bed comp never qualifies at 3 beds.
    const comps = [...fiveComps(), comp({ mlsId: "big", beds: 6 })];
    const res = analyzeComps(comps, subject(), NOW);
    expect(res.comps.map((c) => c.mlsId)).not.toContain("big");
  });

  it("excludes comps outside the sqft tolerance", () => {
    // ±20% of 2000 = 1600–2400; 3200 is out.
    const comps = [...fiveComps(), comp({ mlsId: "huge", sqft: 3200 })];
    const res = analyzeComps(comps, subject(), NOW);
    expect(res.comps.map((c) => c.mlsId)).not.toContain("huge");
  });

  it("excludes sales older than the tier's window", () => {
    const comps = [...fiveComps(), comp({ mlsId: "stale", closeDate: "2020-01-01" })];
    const res = analyzeComps(comps, subject(), NOW);
    expect(res.comps.map((c) => c.mlsId)).not.toContain("stale");
  });

  it("excludes comps with a missing or zero close price", () => {
    const comps = [
      ...fiveComps(),
      comp({ mlsId: "nosale", closePrice: 0 }),
      comp({ mlsId: "negative", closePrice: -5 }),
    ];
    const res = analyzeComps(comps, subject(), NOW);
    const ids = res.comps.map((c) => c.mlsId);
    expect(ids).not.toContain("nosale");
    expect(ids).not.toContain("negative");
  });
});

describe("analyzeComps — automatic widening", () => {
  it("uses the tightest tier and reports no widening when comps are plentiful", () => {
    const res = analyzeComps(fiveComps(), subject(), NOW);
    expect(res.widened).toBe(false);
    expect(res.tier_used).toContain("6mo");
  });

  it("widens the date window when the tight tier is too thin", () => {
    // Three sales 9 months back: outside 6mo, inside 12mo.
    const comps = [200000, 240000, 280000].map((closePrice, i) =>
      comp({ mlsId: `old${i}`, closePrice, closeDate: "2025-10-01" })
    );
    const res = analyzeComps(comps, subject(), NOW);

    expect(res.comps).toHaveLength(3);
    expect(res.widened).toBe(true);
    expect(res.tier_used).toContain("12mo");
    expect(res.range).not.toBeNull();
  });

  it("widens the sqft band when the date window alone is not enough", () => {
    // 2900 sqft: outside ±20% (1600–2400), inside ±35% (1300–2700)? no —
    // ±50% (1000–3000) catches it. Forces the widest tier.
    const comps = [200000, 240000, 280000].map((closePrice, i) =>
      comp({ mlsId: `wide${i}`, closePrice, sqft: 2900 })
    );
    const res = analyzeComps(comps, subject(), NOW);

    expect(res.comps).toHaveLength(3);
    expect(res.widened).toBe(true);
    expect(res.range).not.toBeNull();
  });

  it("returns no range with an insufficient_comps reason when even the widest tier is too thin", () => {
    const res = analyzeComps([comp({ mlsId: "lonely" })], subject(), NOW);

    expect(res.comps.length).toBeLessThan(MIN_COMPS);
    expect(res.range).toBeNull();
    expect(res.basis).toBeNull();
    expect(res.reason).toBe("insufficient_comps");
    // Still tells the caller it tried everything.
    expect(res.widened).toBe(true);
  });

  it("returns no_comps when nothing matches at all", () => {
    const res = analyzeComps([], subject(), NOW);
    expect(res.comps).toHaveLength(0);
    expect(res.range).toBeNull();
    expect(res.reason).toBe("no_comps");
  });
});
