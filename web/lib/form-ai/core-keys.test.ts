import { describe, it, expect } from "vitest";
import { FACT_FIELDS, AUTO_VALUE_KEYS } from "@/lib/contract-facts";
import { CORE_KEYS, isCoreKey } from "@/lib/form-ai/core-keys";

describe("form-ai core keys", () => {
  it("covers exactly the existing registry (FACT_FIELDS + AUTO_VALUE_KEYS)", () => {
    const expected = new Set<string>([
      ...AUTO_VALUE_KEYS,
      ...Object.keys(FACT_FIELDS),
    ]);
    const actual = new Set(CORE_KEYS.map((c) => c.key));
    expect(actual).toEqual(expected);
    // 18 facts + 3 auto = 21 canonical keys — no parallel set invented.
    expect(CORE_KEYS).toHaveLength(expected.size);
  });

  it("gives every key a real description (not a fallback to the key name)", () => {
    for (const c of CORE_KEYS) {
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.description).not.toBe(c.key);
    }
  });

  it("isCoreKey accepts registry keys and rejects anything else", () => {
    expect(isCoreKey("buyer_name")).toBe(true);
    expect(isCoreKey("purchase_price")).toBe(true);
    expect(isCoreKey("totally_made_up")).toBe(false);
    expect(isCoreKey("")).toBe(false);
  });
});
