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
  // Source taxonomy metadata (e.g. "D"); informational, not logic.
  category: string;
  // "" | "baa" — "baa" makes envelope completion flip deals.baa_signed.
  purpose: string;
  // deal participant role -> template role name.
  roleMapping: Record<string, string>;
  fieldMap: Record<string, FieldMapEntry>;
};

export const CONTRACT_FORMS: ContractForm[] = [
  {
    key: "buyer_agency_agreement",
    label: "Buyer Agency Agreement",
    // Used on ALL Alabama deals regardless of area — universal, not Baldwin-only.
    board: "",
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

  // ── Forms wired from RTF_Envelope_Template_Build_Spec (see
  //    docs/RTF_envelope_template_field_map.md). Each goes LIVE only once its
  //    GUID is added to DOCUSIGN_TEMPLATE_IDS — until then they're inert.
  //
  //    Wiring rules baked in here (learned from the live template dumps):
  //    • TYPES: the prefill engine fills only `text` and `checkbox` tabs. The
  //      spec's Date/Number fields are app-prefilled, so they are TEXT here and
  //      MUST be built as Text tabs in DocuSign (a Date/Number tab won't receive
  //      the value). Date Signed / Signature / Initial stay role-owned (no entry).
  //    • AUTO-FILL: only buyer_name/agent_name/brokerage_name (AUTO_VALUE_KEYS)
  //      and keys that EXACTLY match FACT_FIELDS (purchase_price, closing_date,
  //      legal_description, earnest_money_amount, …) prefill from the deal.
  //      TODO(auto-source): seller_name has no auto-source yet, and the spec's
  //      property_city / property_zip / ppin / loan_amount / effective_date don't
  //      match the fact names (city/zip/parcel_or_ppin/loan_amount_or_pct/
  //      acceptance_binding_date) — today the agent re-enters them as terms.
  //    • DUP LABELS: a key can prefill on only ONE role; where the spec repeats a
  //      label across roles (e.g. seller_name in a body line AND a print line) the
  //      entry targets the primary role; the other tab stays signer-filled.
  //    • EXCLUDED: the consumer-signed forms (Wire Fraud, Brokerage Disclosure,
  //      Documentation Fee) need consumer→side routing that lives on the paused
  //      wire-fraud branch — they're wired there, not here.
  {
    key: "lead_based_paint_disclosure",
    label: "Lead-Based Paint Disclosure",
    board: "", // federal — every market
    category: "",
    purpose: "",
    roleMapping: { seller: "Seller1", buyer: "Buyer1", agent: "Agent" },
    fieldMap: {
      property_address: { label: "property_address", type: "text", role: "Seller1" },
      lead_paint_known_present: { label: "lead_paint_known_present", type: "checkbox", role: "Seller1" },
      lead_paint_no_knowledge: { label: "lead_paint_no_knowledge", type: "checkbox", role: "Seller1" },
      lead_paint_explanation: { label: "lead_paint_explanation", type: "text", role: "Seller1" },
      lead_paint_records_provided: { label: "lead_paint_records_provided", type: "checkbox", role: "Seller1" },
      lead_paint_no_records: { label: "lead_paint_no_records", type: "checkbox", role: "Seller1" },
      lead_paint_records_list: { label: "lead_paint_records_list", type: "text", role: "Seller1" },
      lead_paint_inspection_opportunity: { label: "lead_paint_inspection_opportunity", type: "checkbox", role: "Buyer1" },
      lead_paint_inspection_waived: { label: "lead_paint_inspection_waived", type: "checkbox", role: "Buyer1" },
    },
  },
  {
    key: "inspection_addendum",
    label: "Inspection Addendum (ValleyMLS)",
    board: "", // TODO(market): scope to ValleyMLS/Huntsville once that market exists
    category: "",
    purpose: "",
    roleMapping: { buyer: "Buyer1", seller: "Seller1" },
    fieldMap: {
      buyer_name: { label: "buyer_name", type: "text", role: "Buyer1" },
      seller_name: { label: "seller_name", type: "text", role: "Seller1" },
      property_address: { label: "property_address", type: "text", role: "Buyer1" },
      property_city: { label: "property_city", type: "text", role: "Buyer1" },
      property_county: { label: "property_county", type: "text", role: "Buyer1" },
      property_state: { label: "property_state", type: "text", role: "Buyer1" },
      property_zip: { label: "property_zip", type: "text", role: "Buyer1" },
      inspection_notice_days: { label: "inspection_notice_days", type: "text", role: "Buyer1" },
      inspection_additional_provisions: { label: "inspection_additional_provisions", type: "text", role: "Buyer1" },
      addendum_date: { label: "addendum_date", type: "text", role: "Buyer1" },
    },
  },
  {
    key: "contingent_on_sale_addendum",
    label: "Addendum — Contingent on Sale of Buyer's Property",
    board: "BALDWIN_GULF_COAST",
    category: "",
    purpose: "",
    roleMapping: { buyer: "Buyer1", seller: "Seller1" },
    fieldMap: {
      addendum_number: { label: "addendum_number", type: "text", role: "Buyer1" },
      effective_date: { label: "effective_date", type: "text", role: "Buyer1" },
      property_address: { label: "property_address", type: "text", role: "Buyer1" },
      seller_name: { label: "seller_name", type: "text", role: "Buyer1" },
      buyer_name: { label: "buyer_name", type: "text", role: "Buyer1" },
      buyer_property_address: { label: "buyer_property_address", type: "text", role: "Buyer1" },
      buyer_property_for_sale: { label: "buyer_property_for_sale", type: "checkbox", role: "Buyer1" },
      listing_broker_name: { label: "listing_broker_name", type: "text", role: "Buyer1" },
      buyer_property_under_contract: { label: "buyer_property_under_contract", type: "checkbox", role: "Buyer1" },
      backup_response_hours: { label: "backup_response_hours", type: "text", role: "Buyer1" },
      buyer_property_close_by_date: { label: "buyer_property_close_by_date", type: "text", role: "Buyer1" },
      addendum_additional_terms: { label: "addendum_additional_terms", type: "text", role: "Buyer1" },
    },
  },
  {
    key: "baldwin_listing_agreement",
    label: "Baldwin Listing Agreement (Exclusive Right to Sell)",
    board: "BALDWIN_GULF_COAST",
    category: "",
    purpose: "",
    roleMapping: { seller: "Seller1", agent: "Listing Agent" },
    fieldMap: {
      seller_name: { label: "seller_name", type: "text", role: "Seller1" },
      agent_name: { label: "agent_name", type: "text", role: "Listing Agent" },
      brokerage_name: { label: "brokerage_name", type: "text", role: "Listing Agent" },
      property_address: { label: "property_address", type: "text", role: "Seller1" },
      property_city: { label: "property_city", type: "text", role: "Seller1" },
      property_county: { label: "property_county", type: "text", role: "Seller1" },
      property_state: { label: "property_state", type: "text", role: "Seller1" },
      property_zip: { label: "property_zip", type: "text", role: "Seller1" },
      legal_description: { label: "legal_description", type: "text", role: "Seller1" },
      ppin: { label: "ppin", type: "text", role: "Seller1" },
      agreement_start_date: { label: "agreement_start_date", type: "text", role: "Seller1" },
      agreement_end_date: { label: "agreement_end_date", type: "text", role: "Seller1" },
      purchase_price: { label: "purchase_price", type: "text", role: "Seller1" },
      comp_percent: { label: "comp_percent", type: "text", role: "Seller1" },
      comp_flat: { label: "comp_flat", type: "text", role: "Seller1" },
      protection_period_days: { label: "protection_period_days", type: "text", role: "Seller1" },
      dual_agency_authorized: { label: "dual_agency_authorized", type: "checkbox", role: "Seller1" },
      listing_terms: { label: "listing_terms", type: "checkbox", role: "Seller1" },
      home_warranty: { label: "home_warranty", type: "checkbox", role: "Seller1" },
      termite_prior_infestation: { label: "termite_prior_infestation", type: "checkbox", role: "Seller1" },
      termite_under_contract: { label: "termite_under_contract", type: "checkbox", role: "Seller1" },
      has_survey: { label: "has_survey", type: "checkbox", role: "Seller1" },
      has_elevation_cert: { label: "has_elevation_cert", type: "checkbox", role: "Seller1" },
      lockbox_authorized: { label: "lockbox_authorized", type: "checkbox", role: "Seller1" },
      onetime_code_ok: { label: "onetime_code_ok", type: "checkbox", role: "Seller1" },
      is_rental: { label: "is_rental", type: "checkbox", role: "Seller1" },
      title_type: { label: "title_type", type: "checkbox", role: "Seller1" },
      has_poa: { label: "has_poa", type: "checkbox", role: "Seller1" },
      furnishings: { label: "furnishings", type: "checkbox", role: "Seller1" },
    },
  },
  {
    key: "baldwin_listing_agreement_land",
    label: "Baldwin Listing Agreement — Unimproved Land/Lot",
    board: "BALDWIN_GULF_COAST",
    category: "",
    purpose: "",
    // Same core as the residential listing, fewer property-condition checkboxes.
    // TODO(finalize): confirm the exact checkbox set against the land PDF.
    roleMapping: { seller: "Seller1", agent: "Listing Agent" },
    fieldMap: {
      seller_name: { label: "seller_name", type: "text", role: "Seller1" },
      agent_name: { label: "agent_name", type: "text", role: "Listing Agent" },
      brokerage_name: { label: "brokerage_name", type: "text", role: "Listing Agent" },
      property_address: { label: "property_address", type: "text", role: "Seller1" },
      property_city: { label: "property_city", type: "text", role: "Seller1" },
      property_county: { label: "property_county", type: "text", role: "Seller1" },
      property_state: { label: "property_state", type: "text", role: "Seller1" },
      property_zip: { label: "property_zip", type: "text", role: "Seller1" },
      legal_description: { label: "legal_description", type: "text", role: "Seller1" },
      ppin: { label: "ppin", type: "text", role: "Seller1" },
      agreement_start_date: { label: "agreement_start_date", type: "text", role: "Seller1" },
      agreement_end_date: { label: "agreement_end_date", type: "text", role: "Seller1" },
      purchase_price: { label: "purchase_price", type: "text", role: "Seller1" },
      comp_percent: { label: "comp_percent", type: "text", role: "Seller1" },
      comp_flat: { label: "comp_flat", type: "text", role: "Seller1" },
      protection_period_days: { label: "protection_period_days", type: "text", role: "Seller1" },
      dual_agency_authorized: { label: "dual_agency_authorized", type: "checkbox", role: "Seller1" },
      listing_terms: { label: "listing_terms", type: "checkbox", role: "Seller1" },
      lockbox_authorized: { label: "lockbox_authorized", type: "checkbox", role: "Seller1" },
      onetime_code_ok: { label: "onetime_code_ok", type: "checkbox", role: "Seller1" },
      title_type: { label: "title_type", type: "checkbox", role: "Seller1" },
      has_poa: { label: "has_poa", type: "checkbox", role: "Seller1" },
    },
  },
  {
    key: "form_300_birmingham",
    label: "FORM 300 — Birmingham General/Financed Residential Contract",
    board: "BIRMINGHAM_AAR",
    category: "",
    purpose: "",
    roleMapping: { buyer: "Buyer1", seller: "Seller1", agent: "Listing Licensee" },
    fieldMap: {
      buyer_name: { label: "buyer_name", type: "text", role: "Buyer1" },
      seller_name: { label: "seller_name", type: "text", role: "Seller1" },
      property_city: { label: "property_city", type: "text", role: "Buyer1" },
      property_county: { label: "property_county", type: "text", role: "Buyer1" },
      property_address: { label: "property_address", type: "text", role: "Buyer1" },
      property_zip: { label: "property_zip", type: "text", role: "Buyer1" },
      legal_description: { label: "legal_description", type: "text", role: "Buyer1" },
      ppin: { label: "ppin", type: "text", role: "Buyer1" },
      mls_id: { label: "mls_id", type: "text", role: "Buyer1" },
      purchase_price: { label: "purchase_price", type: "text", role: "Buyer1" },
      earnest_money_amount: { label: "earnest_money_amount", type: "text", role: "Buyer1" },
      loan_amount: { label: "loan_amount", type: "text", role: "Buyer1" },
      closing_date: { label: "closing_date", type: "text", role: "Buyer1" },
      effective_date: { label: "effective_date", type: "text", role: "Listing Licensee" },
      listing_agency_role: { label: "listing_agency_role", type: "checkbox", role: "Buyer1" },
      selling_agency_role: { label: "selling_agency_role", type: "checkbox", role: "Buyer1" },
      purchase_money_type: { label: "purchase_money_type", type: "checkbox", role: "Buyer1" },
      loan_type: { label: "loan_type", type: "checkbox", role: "Buyer1" },
      loan_percent: { label: "loan_percent", type: "text", role: "Buyer1" },
      finance_application_days: { label: "finance_application_days", type: "text", role: "Buyer1" },
      appraisal_contingency: { label: "appraisal_contingency", type: "checkbox", role: "Buyer1" },
      seller_concession_amount: { label: "seller_concession_amount", type: "text", role: "Buyer1" },
      buyer_sale_contingency: { label: "buyer_sale_contingency", type: "checkbox", role: "Buyer1" },
      condition_option: { label: "condition_option", type: "checkbox", role: "Buyer1" },
      inspection_period_days: { label: "inspection_period_days", type: "text", role: "Buyer1" },
      lead_paint_attached: { label: "lead_paint_attached", type: "checkbox", role: "Buyer1" },
      home_warranty: { label: "home_warranty", type: "checkbox", role: "Buyer1" },
      agent_name: { label: "agent_name", type: "text", role: "Listing Licensee" },
      brokerage_name: { label: "brokerage_name", type: "text", role: "Listing Licensee" },
      agent_email: { label: "agent_email", type: "text", role: "Listing Licensee" },
      agent_phone: { label: "agent_phone", type: "text", role: "Listing Licensee" },
    },
  },
];

export function committedForm(key: string): ContractForm | undefined {
  return CONTRACT_FORMS.find((f) => f.key === key);
}
