import { describe, it, expect } from "vitest";
import { CONTRACT_FORMS } from "@/lib/contract-forms";
import { isValidMarket } from "@/lib/markets";

// Structural invariants over the committed registry. These are the wiring rules
// that make prefill land correctly — a violation would silently mis-place tabs.
describe("CONTRACT_FORMS registry invariants", () => {
  it("has unique form keys", () => {
    const keys = CONTRACT_FORMS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  for (const form of CONTRACT_FORMS) {
    describe(form.key, () => {
      // A form routes EITHER by participant role (roleMapping) or, for the
      // statewide consumer notices, by ordered consumerRoles. The valid template
      // role names — and the non-empty check — depend on which mode it uses.
      const isConsumers = form.routing === "consumers";
      const roleNames = new Set(
        isConsumers ? form.consumerRoles ?? [] : Object.values(form.roleMapping)
      );

      it("has a non-empty set of template roles with non-empty names", () => {
        expect(roleNames.size).toBeGreaterThan(0);
        for (const v of roleNames) expect(v.length).toBeGreaterThan(0);
      });

      it("board is universal or a real market", () => {
        expect(form.board === "" || isValidMarket(form.board)).toBe(true);
      });

      it("purpose is allowlisted", () => {
        expect(["", "baa"]).toContain(form.purpose);
      });

      for (const [key, entry] of Object.entries(form.fieldMap)) {
        it(`fieldMap "${key}" is well-formed and targets a real role`, () => {
          // Data Label must equal the key (the template tag the agent types).
          expect(entry.label).toBe(key);
          // Prefill only fills text/checkbox tabs.
          expect(["text", "checkbox"]).toContain(entry.type);
          // A field's role MUST be one the form actually routes to, or its value
          // would fall back to the default role and land on the wrong signer.
          if (entry.role) expect(roleNames.has(entry.role)).toBe(true);
        });
      }
    });
  }
});
