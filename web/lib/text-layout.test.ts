import { describe, it, expect } from "vitest";
import { computeTextFingerprint, jaccard, textShingles, minhash, NUM_HASHES } from "@/lib/text-layout";

// Two distinct, varied "form" texts (enough unique 5-word shingles to be real).
const FORM_A =
  "This Residential Purchase Agreement is made between the Buyer and the Seller for the property " +
  "described below. The total purchase price shall be paid as follows, with earnest money deposited " +
  "with the closing agent within three business days of the effective date. The closing shall occur " +
  "on or before the date stated, and possession delivered at closing unless otherwise agreed in " +
  "writing. The Buyer may obtain financing of the conventional, FHA, or VA type, and the appraisal " +
  "contingency applies unless waived. The Seller shall convey marketable title by general warranty deed.";
const FORM_B =
  "This Lead Based Paint Disclosure is provided to the Purchaser as required by federal law. The " +
  "Seller discloses any known lead based paint hazards in the residential dwelling, and provides any " +
  "available records and reports. The Purchaser acknowledges receipt of the disclosure and the EPA " +
  "pamphlet Protect Your Family From Lead In Your Home, and has received a ten day opportunity to " +
  "conduct a risk assessment or inspection, or has waived that opportunity. The agent has informed " +
  "the Seller of the Seller's obligations and is aware of responsibility to ensure compliance.";

describe("text-layout MinHash fingerprint", () => {
  it("is deterministic — same text → identical fingerprint (jaccard 1.0)", () => {
    expect(jaccard(computeTextFingerprint(FORM_A), computeTextFingerprint(FORM_A))).toBe(1);
  });

  it("signature has the fixed width", () => {
    expect(computeTextFingerprint(FORM_A)).toHaveLength(NUM_HASHES);
  });

  it("scores a genuinely different document low", () => {
    expect(jaccard(computeTextFingerprint(FORM_A), computeTextFingerprint(FORM_B))).toBeLessThan(0.2);
  });

  it("ignores whitespace/byte noise (a re-save) → still 1.0", () => {
    const noisy = `  ${FORM_A.replace(/ /g, "  ").replace(/\./g, " . ")}\n\n  `;
    expect(jaccard(computeTextFingerprint(FORM_A), computeTextFingerprint(noisy))).toBe(1);
  });

  it("degrades gracefully under light text edits — high but < 1", () => {
    const words = FORM_A.split(/\s+/);
    const edited = words.filter((_, i) => i % 18 !== 0).join(" "); // drop ~5% of words
    const c = jaccard(computeTextFingerprint(FORM_A), computeTextFingerprint(edited));
    expect(c).toBeGreaterThan(0.5);
    expect(c).toBeLessThan(1);
  });

  it("textShingles dedupes + minhash bounds at the signature width", () => {
    expect(textShingles(FORM_A).length).toBeGreaterThan(10);
    expect(minhash([1, 2, 3])).toHaveLength(NUM_HASHES);
    expect(jaccard([1, 2], [1, 2, 3])).toBe(0); // mismatched widths → 0
  });
});
