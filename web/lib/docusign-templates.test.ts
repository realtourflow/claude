import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  getTemplateConfig,
  listTemplates,
  listTemplatesForMarket,
  TemplateConfigError,
} from "@/lib/docusign-templates";
import { resetEnvForTesting } from "@/lib/env";

// DOCUSIGN_TEMPLATES is environment-aware on purpose: template IDs differ
// between the demo and production DocuSign accounts, so Go-Live is an env swap
// (never a code change). These tests pin the config contract: shape validation,
// clear errors for unknown forms / malformed values, and the role mapping the
// routing layer consumes.

const VALID = {
  buyer_agency_agreement: {
    templateId: "11111111-2222-3333-4444-555555555555",
    label: "Buyer Agency Agreement",
    roleMapping: { buyer: "Buyer", agent: "Agent" },
    purpose: "baa",
    // No board: universal — visible to every market.
  },
  listing_agreement: {
    templateId: "66666666-7777-8888-9999-000000000000",
    label: "Listing Agreement",
    roleMapping: { seller: "Seller", agent: "Agent" },
  },
  birmingham_general_financed: {
    templateId: "77777777-1111-2222-3333-444444444444",
    label: "General/Financed Residential Contract",
    board: "BIRMINGHAM_AAR",
    roleMapping: { buyer: "Buyer", seller: "Seller", agent: "Agent" },
    fieldMap: {
      purchase_price: { label: "PurchasePrice", type: "text" },
      earnest_money_amount: { label: "EarnestMoney", type: "text" },
      inspection_days: { label: "InspectionDays", type: "text", role: "Buyer" },
      home_warranty: { label: "HomeWarranty", type: "checkbox" },
    },
  },
};

const saved = process.env.DOCUSIGN_TEMPLATES;

function setTemplatesEnv(value: string | undefined) {
  if (value === undefined) delete process.env.DOCUSIGN_TEMPLATES;
  else process.env.DOCUSIGN_TEMPLATES = value;
  resetEnvForTesting();
}

beforeEach(() => setTemplatesEnv(JSON.stringify(VALID)));
afterAll(() => setTemplatesEnv(saved));

describe("getTemplateConfig", () => {
  it("resolves a configured form to its template id, label, role mapping, and purpose", () => {
    const cfg = getTemplateConfig("buyer_agency_agreement");
    expect(cfg.templateId).toBe("11111111-2222-3333-4444-555555555555");
    expect(cfg.label).toBe("Buyer Agency Agreement");
    expect(cfg.roleMapping).toEqual({ buyer: "Buyer", agent: "Agent" });
    expect(cfg.purpose).toBe("baa");
  });

  it("defaults purpose to empty when not configured", () => {
    expect(getTemplateConfig("listing_agreement").purpose).toBe("");
  });

  it("throws a clear error naming an unconfigured form key", () => {
    expect(() => getTemplateConfig("unknown_form")).toThrow(TemplateConfigError);
    expect(() => getTemplateConfig("unknown_form")).toThrow(/unknown_form/);
  });

  it("throws a clear error when DOCUSIGN_TEMPLATES is not valid JSON", () => {
    setTemplatesEnv("{not json");
    expect(() => getTemplateConfig("buyer_agency_agreement")).toThrow(
      TemplateConfigError
    );
    expect(() => getTemplateConfig("buyer_agency_agreement")).toThrow(
      /not valid JSON/i
    );
  });

  it("throws a clear error when an entry is missing required fields", () => {
    setTemplatesEnv(JSON.stringify({ bad_form: { label: "No template id" } }));
    expect(() => getTemplateConfig("bad_form")).toThrow(TemplateConfigError);
  });

  it("rejects a purpose outside the allowlist", () => {
    setTemplatesEnv(
      JSON.stringify({
        weird: {
          templateId: "t",
          label: "Weird",
          roleMapping: { buyer: "Buyer" },
          purpose: "exotic",
        },
      })
    );
    expect(() => getTemplateConfig("weird")).toThrow(TemplateConfigError);
  });
});

describe("board + fieldMap (contract-fill registry)", () => {
  it("parses board and fieldMap on a configured form", () => {
    const cfg = getTemplateConfig("birmingham_general_financed");
    expect(cfg.board).toBe("BIRMINGHAM_AAR");
    expect(cfg.fieldMap.purchase_price).toEqual({
      label: "PurchasePrice",
      type: "text",
    });
    expect(cfg.fieldMap.inspection_days.role).toBe("Buyer");
    expect(cfg.fieldMap.home_warranty.type).toBe("checkbox");
  });

  it("defaults board to empty (universal) and fieldMap to {}", () => {
    const cfg = getTemplateConfig("buyer_agency_agreement");
    expect(cfg.board).toBe("");
    expect(cfg.fieldMap).toEqual({});
  });

  it("rejects a fieldMap entry with an invalid type", () => {
    setTemplatesEnv(
      JSON.stringify({
        bad: {
          templateId: "t",
          label: "Bad",
          roleMapping: { buyer: "Buyer" },
          fieldMap: { x: { label: "X", type: "dropdown" } },
        },
      })
    );
    expect(() => getTemplateConfig("bad")).toThrow(TemplateConfigError);
  });
});

describe("listTemplatesForMarket", () => {
  it("returns the market's boarded forms plus universal (board-less) forms", () => {
    const keys = listTemplatesForMarket("BIRMINGHAM_AAR").map((t) => t.key);
    expect(keys).toContain("birmingham_general_financed");
    expect(keys).toContain("buyer_agency_agreement"); // universal
    expect(keys).toContain("listing_agreement"); // universal (no board)
  });

  it("hides other markets' boarded forms", () => {
    const keys = listTemplatesForMarket("BALDWIN_GULF_COAST").map((t) => t.key);
    expect(keys).not.toContain("birmingham_general_financed");
    expect(keys).toContain("buyer_agency_agreement");
  });

  it("an agent with no market sees only universal forms", () => {
    const keys = listTemplatesForMarket("").map((t) => t.key);
    expect(keys).not.toContain("birmingham_general_financed");
    expect(keys).toContain("buyer_agency_agreement");
  });
});

describe("listTemplates", () => {
  it("lists configured forms with key, label, participant roles, and purpose", () => {
    const all = listTemplates();
    expect(all).toHaveLength(3);
    const baa = all.find((t) => t.key === "buyer_agency_agreement");
    expect(baa).toEqual({
      key: "buyer_agency_agreement",
      label: "Buyer Agency Agreement",
      roles: ["buyer", "agent"],
      roleMapping: { buyer: "Buyer", agent: "Agent" },
      purpose: "baa",
      board: "",
      fieldMap: {},
    });
  });

  it("returns an empty list when nothing is configured", () => {
    setTemplatesEnv(undefined); // env default "{}"
    expect(listTemplates()).toEqual([]);
  });
});
