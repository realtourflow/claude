import { describe, it, expect } from "vitest";
import { computeStructureFingerprint } from "@/lib/form-ai/fingerprint";
import type { DetectedField } from "@/lib/form-ai/types";

function f(name: string, type: DetectedField["type"], page = 1): DetectedField {
  return { name, type, page, rect: { x: 0, y: 0, width: 0, height: 0 } };
}

describe("computeStructureFingerprint", () => {
  it("is identical for the same fields in a different order (sort-stable)", () => {
    const a = computeStructureFingerprint([f("buyer_name", "text"), f("agree", "checkbox")], 1);
    const b = computeStructureFingerprint([f("agree", "checkbox"), f("buyer_name", "text")], 1);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).toMatch(/^v1:[0-9a-f]{64}$/);
  });

  it("collapses multi-widget fields (name#1/name#2) to one logical field", () => {
    const single = computeStructureFingerprint([f("sig", "signature")], 1);
    const multi = computeStructureFingerprint([f("sig#1", "signature"), f("sig#2", "signature")], 1);
    expect(single.fieldCount).toBe(1);
    expect(multi.fieldCount).toBe(1);
  });

  it("changes when a field is renamed, retyped, or the page count changes", () => {
    const base = computeStructureFingerprint([f("buyer_name", "text"), f("agree", "checkbox")], 1).fingerprint;
    expect(computeStructureFingerprint([f("seller_name", "text"), f("agree", "checkbox")], 1).fingerprint).not.toBe(base);
    expect(computeStructureFingerprint([f("buyer_name", "checkbox"), f("agree", "checkbox")], 1).fingerprint).not.toBe(base);
    expect(computeStructureFingerprint([f("buyer_name", "text"), f("agree", "checkbox")], 2).fingerprint).not.toBe(base);
  });

  it("flags generic auto-named forms via genericRatio (the false-positive guard)", () => {
    const generic = computeStructureFingerprint(
      [f("Text1", "text"), f("Text2", "text"), f("Check Box1", "checkbox")],
      1
    );
    expect(generic.genericRatio).toBe(1);
    expect(computeStructureFingerprint([f("buyer_name", "text"), f("agree", "checkbox")], 1).genericRatio).toBe(0);
  });

  it("treats an empty form as fully generic (refused)", () => {
    expect(computeStructureFingerprint([], 1).genericRatio).toBe(1);
  });
});
