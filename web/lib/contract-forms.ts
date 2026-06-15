/**
 * Committed contract-form registry.
 *
 * A form's STRUCTURE — label, board, roleMapping, fieldMap — lives here in code
 * so it's reviewed in PRs. Only the DocuSign templateId is environment-specific
 * (demo vs production accounts differ), so it comes from the DOCUSIGN_TEMPLATE_IDS
 * env map keyed by form key. A committed form is "live" only once its template
 * id is set in env (Go-Live = an ID swap, never a code change).
 *
 * `DOCUSIGN_TEMPLATES` (full env entries) still works for ad-hoc / override
 * forms and wins on key conflict — see lib/docusign-templates.ts.
 *
 * fieldMap keys are either:
 *   - auto-sourced from the deal (see AUTO_VALUE_KEYS in lib/contract-facts.ts:
 *     buyer_name, agent_name, brokerage_name) — filled automatically at send;
 *   - core facts (lib/contract-facts FACT_FIELDS) — prefilled from the deal;
 *   - per-form terms — the agent enters them in the prep step.
 * Each entry's `label` MUST equal the template's tab Data Label exactly, and
 * `role` is the template role whose tab carries the value.
 */
import type { FieldMapEntry } from "./docusign-templates";

export type ContractForm = {
  key: string;
  label: string;
  // "" = universal (every market). Otherwise a market code (lib/markets).
  board: string;
  // Source taxonomy metadata; informational, not logic.
  keyType: string; // e.g. "BOARD" | "UNIFORM"
  category: string; // e.g. "D" | "E"
  // "" | "baa" — "baa" makes envelope completion flip deals.baa_signed.
  purpose: string;
  // Recipient derivation:
  //  - "by-role" (default): roleMapping maps each deal participant role to one
  //    template role (e.g. buyer→Buyer, agent→Agent).
  //  - "consumers": the deal's client-side participants (buyers on a buy deal,
  //    sellers on a sell deal) fill consumerRoles in order — Consumer1 required,
  //    the rest optional; no agent signer. Used by statewide UNIFORM notices.
  routing?: "by-role" | "consumers";
  // deal participant role -> template role name (by-role mode).
  roleMapping: Record<string, string>;
  // Ordered template role names for "consumers" mode; [0] is required.
  consumerRoles?: string[];
  fieldMap: Record<string, FieldMapEntry>;
};

export const CONTRACT_FORMS: ContractForm[] = [
  {
    key: "buyer_agency_agreement",
    label: "Buyer Agency Agreement",
    // Used on ALL Alabama deals regardless of area — universal, not Baldwin-only.
    board: "",
    keyType: "BOARD",
    category: "D",
    purpose: "baa",
    roleMapping: { buyer: "Buyer", agent: "Agent" },
    // Source: Baldwin REALTORS BAA (Baldwin_BuyerSide_Form_Fields.xlsx §5).
    // Labels mirror the template Data Labels (snake_case). Signature / date /
    // initial fields are handled by the template roles, not prefilled here.
    // DEFERRED (not prefilled in v1 — completed during signing): the election
    // checkbox groups (covered-property any/specific, compensation type,
    // dual-agency does/does-not, disclosure-of-identity does/does-not) need each
    // checkbox's individual Data Label; and the buyer/agent contact blobs.
    fieldMap: {
      // Auto-sourced from the deal at send time.
      buyer_name: { label: "buyer_name", type: "text", role: "Buyer" },
      agent_name: { label: "agent_name", type: "text", role: "Agent" },
      brokerage_name: { label: "brokerage_name", type: "text", role: "Agent" },
      // Agent-entered terms (prep step) — placed on the Agent role (preparer).
      baa_term_end: { label: "baa_term_end", type: "text", role: "Agent" },
      baa_covered_property_text: { label: "baa_covered_property_text", type: "text", role: "Agent" },
      baa_property_desc: { label: "baa_property_desc", type: "text", role: "Agent" },
      baa_property_location: { label: "baa_property_location", type: "text", role: "Agent" },
      baa_comp_retainer: { label: "baa_comp_retainer", type: "text", role: "Agent" },
      baa_comp_percent: { label: "baa_comp_percent", type: "text", role: "Agent" },
      baa_comp_flat: { label: "baa_comp_flat", type: "text", role: "Agent" },
      baa_comp_other: { label: "baa_comp_other", type: "text", role: "Agent" },
      baa_tail_days: { label: "baa_tail_days", type: "text", role: "Agent" },
    },
  },
  {
    key: "al_wire_fraud_notice",
    label: "Wire Fraud Prevention Notice",
    // Alabama REALTORS statewide uniform notice — every market, both sides.
    board: "",
    keyType: "UNIFORM",
    category: "E",
    purpose: "",
    // The signers are the deal's consumers (buyers on a buy deal, sellers on a
    // sell deal); no agent signs. One shared template for both sides.
    routing: "consumers",
    roleMapping: {},
    consumerRoles: ["Consumer1", "Consumer2"], // Consumer2 optional
    // All auto-sourced from the deal — no agent-entered terms. consumer_name /
    // consumer_name_2 are the 1st / 2nd consumer; brokerage_name is the agent's.
    fieldMap: {
      consumer_name: { label: "consumer_name", type: "text", role: "Consumer1" },
      consumer_name_2: { label: "consumer_name_2", type: "text", role: "Consumer2" },
      brokerage_name: { label: "brokerage_name", type: "text", role: "Consumer1" },
    },
  },
];

export function committedForm(key: string): ContractForm | undefined {
  return CONTRACT_FORMS.find((f) => f.key === key);
}
