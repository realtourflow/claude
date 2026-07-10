import { describe, it, expect } from "vitest";
import { extractClosingDate, parseDateOnly } from "./arive-dates";

describe("extractClosingDate (#196)", () => {
  it("reads estimatedFundingDate first", () => {
    expect(
      extractClosingDate({
        estimatedFundingDate: "2026-09-15",
        closingContingency: "2026-10-01",
      })
    ).toBe("2026-09-15");
  });

  it("falls back to closingContingency", () => {
    expect(extractClosingDate({ closingContingency: "2026-10-01" })).toBe(
      "2026-10-01"
    );
  });

  it("ignores the legacy closing/closing_date keys (never populated by ARIVE)", () => {
    expect(
      extractClosingDate({ closing: "2026-09-15", closing_date: "2026-09-15" })
    ).toBeNull();
  });

  it("returns null for null, non-objects, and empty objects", () => {
    expect(extractClosingDate(null)).toBeNull();
    expect(extractClosingDate(undefined)).toBeNull();
    expect(extractClosingDate("2026-09-15")).toBeNull();
    expect(extractClosingDate(42)).toBeNull();
    expect(extractClosingDate({})).toBeNull();
  });

  it("treats blank and non-string values as absent, and trims", () => {
    expect(extractClosingDate({ estimatedFundingDate: "  " })).toBeNull();
    expect(extractClosingDate({ estimatedFundingDate: 20260915 })).toBeNull();
    expect(extractClosingDate({ estimatedFundingDate: " 2026-09-15 " })).toBe(
      "2026-09-15"
    );
  });
});

describe("parseDateOnly", () => {
  it("parses a date-only string as UTC midnight", () => {
    expect(parseDateOnly("2026-09-15")?.toISOString()).toBe(
      "2026-09-15T00:00:00.000Z"
    );
  });

  it("parses full RFC3339 timestamps", () => {
    expect(parseDateOnly("2026-09-15T17:30:00Z")?.toISOString()).toBe(
      "2026-09-15T17:30:00.000Z"
    );
  });

  it("returns null for garbage", () => {
    expect(parseDateOnly("not-a-date")).toBeNull();
  });
});
