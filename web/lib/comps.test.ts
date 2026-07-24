import { describe, it, expect } from "vitest";
import {
  analyzeComps,
  percentile,
  tukeyFence,
  extractPostalCode,
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
    postalCode: "",
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

describe("extractPostalCode", () => {
  it("pulls the ZIP off the end of an address", () => {
    expect(extractPostalCode("500 Subject Ln, Hoover, AL 35244")).toBe("35244");
    expect(extractPostalCode("1 Main St, Hoover, AL 35244-1234")).toBe("35244");
  });

  it("returns '' when there is no trailing ZIP", () => {
    expect(extractPostalCode("500 Subject Ln")).toBe("");
    // A 5-digit street number is NOT a ZIP (not at the end).
    expect(extractPostalCode("35244 Cahaba River Rd")).toBe("");
  });
});

describe("tukeyFence", () => {
  it("brackets Q1-1.5·IQR .. Q3+1.5·IQR", () => {
    // [100,110,120,130,140] → Q1 110, Q3 130, IQR 20 → [80, 160].
    expect(tukeyFence([120, 100, 140, 110, 130])).toEqual({ lo: 80, hi: 160 });
  });
});

describe("analyzeComps — postal-code proximity", () => {
  const subjZip = subject({ postalCode: "35244" });

  it("scopes the tightest tier to the subject's ZIP", () => {
    const comps = [
      ...[200000, 220000, 240000].map((p, i) =>
        comp({ mlsId: `in${i}`, closePrice: p, postalCode: "35244" })
      ),
      // Same city, different ZIP — must be excluded while same-ZIP comps suffice.
      comp({ mlsId: "otherzip", closePrice: 900000, postalCode: "35080" }),
    ];
    const res = analyzeComps(comps, subjZip, NOW);

    expect(res.tier_used).toContain("same ZIP");
    expect(res.widened).toBe(false);
    expect(res.comps.map((c) => c.mlsId)).not.toContain("otherzip");
    expect(res.comps).toHaveLength(3);
  });

  it("widens from ZIP to city when the ZIP is too thin", () => {
    const comps = [
      comp({ mlsId: "z1", closePrice: 240000, postalCode: "35244" }),
      ...[200000, 220000, 260000].map((p, i) =>
        comp({ mlsId: `c${i}`, closePrice: p, postalCode: "35080" })
      ),
    ];
    const res = analyzeComps(comps, subjZip, NOW);

    // Only one same-ZIP sale → falls through to same-city.
    expect(res.tier_used).toContain("same city");
    expect(res.widened).toBe(true);
    expect(res.comps.length).toBeGreaterThanOrEqual(MIN_COMPS);
  });

  it("uses city scope (no ZIP tier) when the subject has no postal code", () => {
    const res = analyzeComps(fiveComps(), subject(), NOW);
    expect(res.tier_used).toContain("same city");
    expect(res.tier_used).not.toContain("ZIP");
  });
});

describe("analyzeComps — outlier rejection", () => {
  it("drops a wild sale via the IQR fence and ranges on the survivors", () => {
    // Five tight comps at $100–120/sqft + one 5× outlier.
    const comps = [
      ...[200000, 210000, 220000, 230000, 240000].map((p, i) =>
        comp({ mlsId: `t${i}`, closePrice: p })
      ),
      comp({ mlsId: "wild", closePrice: 1000000 }),
    ];
    const res = analyzeComps(comps, subject(), NOW);

    expect(res.outliers_removed).toBe(1);
    expect(res.comps.map((c) => c.mlsId)).not.toContain("wild");
    // Range reflects the clean five ($105–115/sqft × 2000 sqft).
    expect(res.range).toEqual({ low: 210000, high: 230000 });
  });

  it("does not reject with too few comps to detect outliers (n < 5)", () => {
    const comps = [
      comp({ mlsId: "a", closePrice: 200000 }),
      comp({ mlsId: "b", closePrice: 220000 }),
      comp({ mlsId: "c", closePrice: 240000 }),
      comp({ mlsId: "wild", closePrice: 900000 }),
    ];
    const res = analyzeComps(comps, subject(), NOW);
    expect(res.outliers_removed).toBe(0);
    expect(res.comps.map((c) => c.mlsId)).toContain("wild");
  });

  it("never rejects so hard it starves the range below MIN_COMPS", () => {
    // Bimodal: 3 low + 2 high. A naive fence might cull one cluster; the guard
    // keeps at least MIN_COMPS, so nothing is dropped here.
    const comps = [
      ...[200000, 205000, 210000].map((p, i) => comp({ mlsId: `lo${i}`, closePrice: p })),
      ...[900000, 950000].map((p, i) => comp({ mlsId: `hi${i}`, closePrice: p })),
    ];
    const res = analyzeComps(comps, subject(), NOW);
    // Whatever the fence proposes, the result stays >= MIN_COMPS.
    expect(res.comps.length).toBeGreaterThanOrEqual(MIN_COMPS);
    expect(res.range).not.toBeNull();
  });
});
