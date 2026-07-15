/**
 * recalcLines property-tax proration (#259).
 *
 * Regression guard for the UTC/local date mix in the proration branch. The
 * closing date is date-only ("2026-01-01" from the date input, or the API
 * shape "2026-01-01T00:00:00.000Z"). `new Date()` parses that as UTC midnight,
 * but `getFullYear()` + the `new Date(year, 0, 1)` anchor read LOCAL time — so
 * in any negative-offset US timezone a Jan 1 close resolved to local Dec 31 of
 * the PRIOR year and prorated ~a full year of taxes instead of one day. The
 * divisor was also hard-coded to 365, so leap years mis-prorated.
 *
 * CI runs in UTC, where the year never flips and the bug hides. Pin a
 * negative-offset US zone (America/Chicago, UTC-6/-5) BEFORE importing the
 * module so the regression actually reproduces here and in CI. The shipped fix
 * is timezone-independent (UTC getters + real days-in-year), so these pass in
 * any zone once fixed — but this pin is what makes them FAIL pre-fix.
 */
process.env.TZ = "America/Chicago";

import { describe, it, expect } from "vitest";
import { recalcLines, type NetSheetLine } from "@/hooks/useNetSheet";

// A property_tax_proration line as the net-sheet defaults seed it: percentage
// mode so recalcLines enters the proration branch. The pct value itself is
// unused there — proration is annualTaxes × dayOfYear / daysInYear, never
// salePrice × pct — but it must be non-null with isPct true to be recalculated.
function prorationLine(overrides: Partial<NetSheetLine> = {}): NetSheetLine {
  return {
    id: "property_tax_proration",
    label: "Property Tax Proration (Seller's share)",
    category: "proration",
    amount: 0,
    pct: 0,
    isPct: true,
    required: true,
    enabled: true,
    editable: false,
    autoPopulated: true,
    ...overrides,
  };
}

// Run one proration line through recalcLines and return the computed amount.
// salePrice is irrelevant to proration; pass a realistic value.
function prorate(annualTaxes: number, closingDate: string | null): number {
  const [line] = recalcLines([prorationLine()], 500_000, annualTaxes, closingDate);
  return line.amount;
}

describe("recalcLines — property-tax proration (#259)", () => {
  // Case 1 — the headline bug. A Jan 1 close is one day, not a whole year.
  // Pre-fix (in a US zone) this returns ~3650, a full year of taxes.
  it("charges a single day of taxes for a Jan 1 closing (date-only input)", () => {
    expect(prorate(3650, "2026-01-01")).toBe(10); // 3650 / 365 = 10/day, day 1
  });

  it("charges a single day of taxes for a Jan 1 closing (API ISO shape)", () => {
    expect(prorate(3650, "2026-01-01T00:00:00.000Z")).toBe(10);
  });

  // Case 2 — leap years use 366, and a full-year close never bills more than
  // the annual amount. Guards the hard-coded 365 divisor.
  it("uses 366 days in a leap year and never exceeds the annual bill", () => {
    const amount = prorate(3660, "2028-12-31"); // day 366 of 366 → full bill
    expect(amount).toBe(3660);
    expect(amount).toBeLessThanOrEqual(3660);
  });

  it("bills exactly one year for a Dec 31 close (common and leap years)", () => {
    // Full-year proration must equal the bill exactly — not 365/366ths of it,
    // and never 366/365ths over it. Pre-fix (US zone) the common-year case
    // drifts a day low; this pins both.
    expect(prorate(3650, "2026-12-31")).toBe(3650); // common year, 365/365
    expect(prorate(3660, "2028-12-31")).toBe(3660); // leap year, 366/366
  });

  // Case 3 — mid-year proration lands on the correct day, and the empty cases
  // stay at zero.
  it("prorates to the correct day for a mid-year closing", () => {
    // 2026-07-01 is day 182 of 365.
    expect(prorate(3650, "2026-07-01")).toBe(Math.round((3650 * 182) / 365));
  });

  it("returns 0 when there are no taxes or no closing date", () => {
    expect(prorate(0, "2026-07-01")).toBe(0); // no taxes
    expect(prorate(3650, null)).toBe(0); // no closing date
    expect(prorate(3650, "")).toBe(0); // empty closing date
  });
});
