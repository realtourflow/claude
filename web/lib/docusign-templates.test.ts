import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  getTemplateConfig,
  listTemplates,
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
  },
  listing_agreement: {
    templateId: "66666666-7777-8888-9999-000000000000",
    label: "Listing Agreement",
    roleMapping: { seller: "Seller", agent: "Agent" },
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

describe("listTemplates", () => {
  it("lists configured forms with key, label, participant roles, and purpose", () => {
    const all = listTemplates();
    expect(all).toHaveLength(2);
    const baa = all.find((t) => t.key === "buyer_agency_agreement");
    expect(baa).toEqual({
      key: "buyer_agency_agreement",
      label: "Buyer Agency Agreement",
      roles: ["buyer", "agent"],
      roleMapping: { buyer: "Buyer", agent: "Agent" },
      purpose: "baa",
    });
  });

  it("returns an empty list when nothing is configured", () => {
    setTemplatesEnv(undefined); // env default "{}"
    expect(listTemplates()).toEqual([]);
  });
});
