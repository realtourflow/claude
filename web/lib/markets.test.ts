import { describe, it, expect } from "vitest";
import { MARKETS, isValidMarket, marketLabel } from "@/lib/markets";

describe("markets", () => {
  it("exposes the two launch markets with friendly labels", () => {
    expect(MARKETS.map((m) => m.code)).toEqual([
      "BIRMINGHAM_AAR",
      "BALDWIN_GULF_COAST",
    ]);
    expect(marketLabel("BIRMINGHAM_AAR")).toBe("Birmingham");
    expect(marketLabel("BALDWIN_GULF_COAST")).toBe("Alabama Gulf Coast");
  });

  it("validates known codes and rejects everything else", () => {
    expect(isValidMarket("BIRMINGHAM_AAR")).toBe(true);
    expect(isValidMarket("BALDWIN_GULF_COAST")).toBe(true);
    expect(isValidMarket("")).toBe(false);
    expect(isValidMarket("birmingham")).toBe(false);
    expect(isValidMarket("ATLANTA")).toBe(false);
  });

  it("labels unknown/empty codes as Not set", () => {
    expect(marketLabel("")).toBe("Not set");
    expect(marketLabel("NOPE")).toBe("Not set");
  });
});
