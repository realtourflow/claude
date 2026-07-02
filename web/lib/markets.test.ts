import { describe, it, expect } from "vitest";
import { MARKETS, MARKET_GROUPS, isValidMarket, marketLabel } from "@/lib/markets";

describe("markets", () => {
  it("exposes the full 21-market list across the six groups", () => {
    expect(MARKETS).toHaveLength(21);
    // Every market belongs to one of the declared groups; every group has entries.
    for (const m of MARKETS) {
      expect(MARKET_GROUPS).toContain(m.group);
    }
    for (const g of MARKET_GROUPS) {
      expect(MARKETS.some((m) => m.group === g)).toBe(true);
    }
    // Codes are unique.
    expect(new Set(MARKETS.map((m) => m.code)).size).toBe(MARKETS.length);
  });

  it("keeps the legacy launch codes (stored in prod rows) with updated labels", () => {
    expect(marketLabel("BIRMINGHAM_AAR")).toBe("Birmingham Metro");
    expect(marketLabel("BALDWIN_GULF_COAST")).toBe("Baldwin County / Gulf Coast");
  });

  it("validates known codes and rejects everything else", () => {
    expect(isValidMarket("BIRMINGHAM_AAR")).toBe(true);
    expect(isValidMarket("BALDWIN_GULF_COAST")).toBe(true);
    expect(isValidMarket("HUNTSVILLE")).toBe(true);
    expect(isValidMarket("LAKE_MARTIN")).toBe(true);
    expect(isValidMarket("")).toBe(false);
    expect(isValidMarket("birmingham")).toBe(false);
    expect(isValidMarket("ATLANTA")).toBe(false);
  });

  it("labels unknown/empty codes as Not set", () => {
    expect(marketLabel("")).toBe("Not set");
    expect(marketLabel("NOPE")).toBe("Not set");
  });
});
