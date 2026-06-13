import { describe, it, expect } from "vitest";
import { buildPrefillTabs } from "@/lib/docusign-prefill";
import type { FieldMapEntry } from "@/lib/docusign-templates";

// The prefill engine turns merged contract values (deal facts ∪ per-form
// terms) into per-role DocuSign tab payloads via the form's fieldMap. Pure —
// the send route resolves values server-side and hands them in.

const FIELD_MAP: Record<string, FieldMapEntry> = {
  purchase_price: { label: "PurchasePrice", type: "text" },
  closing_date: { label: "ClosingDate", type: "text" },
  inspection_days: { label: "InspectionDays", type: "text", role: "Buyer" },
  home_warranty: { label: "HomeWarranty", type: "checkbox" },
  flood_zone: { label: "FloodZone", type: "checkbox", role: "Seller" },
};

describe("buildPrefillTabs", () => {
  it("maps values to text/checkbox tabs grouped by role (default role when unset)", () => {
    const tabs = buildPrefillTabs({
      fieldMap: FIELD_MAP,
      values: {
        purchase_price: 425000,
        closing_date: new Date("2026-08-15T00:00:00Z"),
        inspection_days: 10,
        home_warranty: true,
        flood_zone: false,
      },
      defaultRole: "Buyer",
    });

    // Default-role fields land on Buyer; role-tagged fields on their role.
    expect(tabs.Buyer.textTabs).toEqual([
      { tabLabel: "PurchasePrice", value: "425000" },
      { tabLabel: "ClosingDate", value: "08/15/2026" },
      { tabLabel: "InspectionDays", value: "10" },
    ]);
    expect(tabs.Buyer.checkboxTabs).toEqual([
      { tabLabel: "HomeWarranty", selected: "true" },
    ]);
    // Explicit false still serializes (unchecks a template default).
    expect(tabs.Seller.checkboxTabs).toEqual([
      { tabLabel: "FloodZone", selected: "false" },
    ]);
  });

  it("skips fields with no value (undefined / null / empty string)", () => {
    const tabs = buildPrefillTabs({
      fieldMap: FIELD_MAP,
      values: { purchase_price: undefined, closing_date: null, inspection_days: "" },
      defaultRole: "Buyer",
    });
    expect(tabs).toEqual({});
  });

  it("ignores values with no fieldMap entry", () => {
    const tabs = buildPrefillTabs({
      fieldMap: FIELD_MAP,
      values: { mystery_key: "x", purchase_price: 1 },
      defaultRole: "Buyer",
    });
    expect(tabs.Buyer.textTabs).toEqual([
      { tabLabel: "PurchasePrice", value: "1" },
    ]);
  });
});
