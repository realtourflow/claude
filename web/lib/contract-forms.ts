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
    category: "D",
    purpose: "baa",
    roleMapping: { buyer: "Buyer", agent: "Agent" },
    // Wired to the built template GUID 863df439 (old "baa_*" label scheme — the
    // shipped version, not the expanded spec). Labels mirror the template's tab
    // Data Labels exactly. buyer_name/agent_name are FullName tabs on the
    // template (auto-fill the signer's name); the textTab values here are
    // harmless no-ops for those two but drive the prep/auto-fill model.
    // DEFERRED (completed during signing — the template uses ONE repeated label
    // per group, so they can't be individually prefilled): the compensation /
    // disclosure election checkboxes and the buyer/agent contact blobs. Giving
    // those distinct labels is what the expanded spec rebuild would add.
    fieldMap: {
      // Auto-sourced from the deal at send time.
      buyer_name: { label: "buyer_name", type: "text", role: "Buyer" },
      agent_name: { label: "agent_name", type: "text", role: "Agent" },
      brokerage_name: { label: "brokerage_name", type: "text", role: "Agent" },
      // Agent-entered terms (prep step) — placed on the Agent role (preparer).
      baa_term_end: { label: "baa_term_end", type: "text", role: "Agent" },
      baa_property_desc: { label: "baa_property_desc", type: "text", role: "Agent" },
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
  //    • CONSUMER-SIGNED: the Wire Fraud Notice (above) uses the "consumers"
  //      routing mode — client-side signers, no agent. The other consumer forms
  //      (Brokerage Disclosure, Documentation Fee) still need wiring.
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
    // Wired to match the built "Purchase_Agreement" template exactly: the buyer's
    // agent (role BuyerAgent) prepares the offer, so every data field sits on that
    // role; only the signer print-names are on Buyer1 / Seller1. Many fields
    // auto-fill via CONTRACT_FIELD_ALIASES (property_*, ppin, loan_amount,
    // effective_date, possession_date, buyer_agent, …); the rest the agent sets
    // in prep. (Labels with a "/" mirror the template's Data Labels verbatim.)
    key: "form_300_birmingham",
    label: "FORM 300 — Birmingham General/Financed Residential Contract",
    board: "BIRMINGHAM_AAR",
    category: "",
    purpose: "",
    roleMapping: { buyer: "Buyer1", seller: "Seller1", agent: "BuyerAgent" },
    fieldMap: {
      // Signer print-names.
      buyer_name: { label: "buyer_name", type: "text", role: "Buyer1" },
      seller_name: { label: "seller_name", type: "text", role: "Seller1" },
      // Property + identifiers (BuyerAgent).
      property_city: { label: "property_city", type: "text", role: "BuyerAgent" },
      property_county: { label: "property_county", type: "text", role: "BuyerAgent" },
      property_zip: { label: "property_zip", type: "text", role: "BuyerAgent" },
      property_address: { label: "property_address", type: "text", role: "BuyerAgent" },
      legal_description: { label: "legal_description", type: "text", role: "BuyerAgent" },
      ppin: { label: "ppin", type: "text", role: "BuyerAgent" },
      mls_id: { label: "mls_id", type: "text", role: "BuyerAgent" },
      // Agency block.
      buyer_agent: { label: "buyer_agent", type: "text", role: "BuyerAgent" },
      listing_agent: { label: "listing_agent", type: "text", role: "BuyerAgent" },
      listing_agent_of_seller: { label: "listing_agent_of_seller", type: "checkbox", role: "BuyerAgent" },
      buyer_agent_of_buyer: { label: "buyer_agent_of_buyer", type: "checkbox", role: "BuyerAgent" },
      listing_dual_agent: { label: "listing_dual_agent", type: "checkbox", role: "BuyerAgent" },
      buyer_dual_agent: { label: "buyer_dual_agent", type: "checkbox", role: "BuyerAgent" },
      listing_transaction_facilitator: { label: "listing_transaction_facilitator", type: "checkbox", role: "BuyerAgent" },
      buyer_transaction_facilitator: { label: "buyer_transaction_facilitator", type: "checkbox", role: "BuyerAgent" },
      // Price + financing.
      purchase_price: { label: "purchase_price", type: "text", role: "BuyerAgent" },
      earnest_money_amount: { label: "earnest_money_amount", type: "text", role: "BuyerAgent" },
      cash_buyer: { label: "cash_buyer", type: "checkbox", role: "BuyerAgent" },
      financing_buyer: { label: "financing_buyer", type: "checkbox", role: "BuyerAgent" },
      conventional: { label: "conventional", type: "checkbox", role: "BuyerAgent" },
      FHA: { label: "FHA", type: "checkbox", role: "BuyerAgent" },
      VA: { label: "VA", type: "checkbox", role: "BuyerAgent" },
      other_financing: { label: "other_financing", type: "checkbox", role: "BuyerAgent" },
      other_financing_description: { label: "other_financing_description", type: "text", role: "BuyerAgent" },
      loan_amount: { label: "loan_amount", type: "text", role: "BuyerAgent" },
      finance_contingency_date: { label: "finance_contingency_date", type: "text", role: "BuyerAgent" },
      // Appraisal / concession / sale contingency.
      appraisal_contingency_is: { label: "appraisal_contingency_is", type: "checkbox", role: "BuyerAgent" },
      appraisal_contingency_not: { label: "appraisal_contingency_not", type: "checkbox", role: "BuyerAgent" },
      Buyer_broker_comp_checkbox: { label: "Buyer_broker_comp_checkbox", type: "checkbox", role: "BuyerAgent" },
      buyer_broker_comp_percentage: { label: "buyer_broker_comp_percentage", type: "text", role: "BuyerAgent" },
      seller_concession_yes: { label: "seller_concession_yes", type: "checkbox", role: "BuyerAgent" },
      seller_concession_amount: { label: "seller_concession_amount", type: "text", role: "BuyerAgent" },
      buyer_sale_contingency_is: { label: "buyer_sale_contingency_is", type: "checkbox", role: "BuyerAgent" },
      buyer_sale_contingency_not: { label: "buyer_sale_contingency_not", type: "checkbox", role: "BuyerAgent" },
      // Closing / possession / title.
      closing_date: { label: "closing_date", type: "text", role: "BuyerAgent" },
      possession_date: { label: "possession_date", type: "text", role: "BuyerAgent" },
      seller_title_expense: { label: "seller_title_expense", type: "checkbox", role: "BuyerAgent" },
      buyer_title_expense: { label: "buyer_title_expense", type: "checkbox", role: "BuyerAgent" },
      title_split: { label: "title_split", type: "checkbox", role: "BuyerAgent" },
      is_homestead: { label: "is_homestead", type: "checkbox", role: "BuyerAgent" },
      is_not_homestead: { label: "is_not_homestead", type: "checkbox", role: "BuyerAgent" },
      warranty_deed_type: { label: "warranty_deed_type", type: "text", role: "BuyerAgent" },
      buyer_joint_tenancy: { label: "buyer_joint_tenancy", type: "checkbox", role: "BuyerAgent" },
      joint_tenancy: { label: "joint_tenancy", type: "checkbox", role: "BuyerAgent" },
      not_joint_tenancy: { label: "not_joint_tenancy", type: "checkbox", role: "BuyerAgent" },
      // Inspection.
      not_contingent_upon_inspection: { label: "not_contingent_upon_inspection", type: "checkbox", role: "BuyerAgent" },
      contingent_upon_inspection_no_repair: { label: "contingent_upon_inspection_no_repair", type: "checkbox", role: "BuyerAgent" },
      contingent_upon_inspection_and_repairs: { label: "contingent_upon_inspection_and_repairs", type: "checkbox", role: "BuyerAgent" },
      inspection_completion_date: { label: "inspection_completion_date", type: "text", role: "BuyerAgent" },
      // Water-in-roof / termite / sewer-septic disclosures.
      wir_is: { label: "wir_is", type: "checkbox", role: "BuyerAgent" },
      wir_is_not: { label: "wir_is_not", type: "checkbox", role: "BuyerAgent" },
      wir_buyer: { label: "wir_buyer", type: "checkbox", role: "BuyerAgent" },
      wir_seller: { label: "wir_seller", type: "checkbox", role: "BuyerAgent" },
      termite_is: { label: "termite_is", type: "checkbox", role: "BuyerAgent" },
      termite_is_not: { label: "termite_is_not", type: "checkbox", role: "BuyerAgent" },
      termite_seller_expense: { label: "termite_seller_expense", type: "checkbox", role: "BuyerAgent" },
      termite_buyer_expense: { label: "termite_buyer_expense", type: "checkbox", role: "BuyerAgent" },
      seller_has_paid: { label: "seller_has_paid", type: "checkbox", role: "BuyerAgent" },
      seller_has_not_paid: { label: "seller_has_not_paid", type: "checkbox", role: "BuyerAgent" },
      is_sewer: { label: "is_sewer", type: "checkbox", role: "BuyerAgent" },
      is_septic: { label: "is_septic", type: "checkbox", role: "BuyerAgent" },
      is_not_septic: { label: "is_not_septic", type: "checkbox", role: "BuyerAgent" },
      "buyer_requires_sewer/septic": { label: "buyer_requires_sewer/septic", type: "checkbox", role: "BuyerAgent" },
      "buyer_not_require_sewer/septic": { label: "buyer_not_require_sewer/septic", type: "checkbox", role: "BuyerAgent" },
      // Survey / lead paint / condo.
      survey_is: { label: "survey_is", type: "checkbox", role: "BuyerAgent" },
      survey_is_not: { label: "survey_is_not", type: "checkbox", role: "BuyerAgent" },
      paint_attached_yes: { label: "paint_attached_yes", type: "checkbox", role: "BuyerAgent" },
      paint_attached_no: { label: "paint_attached_no", type: "checkbox", role: "BuyerAgent" },
      is_condo: { label: "is_condo", type: "checkbox", role: "BuyerAgent" },
      is_not_condo: { label: "is_not_condo", type: "checkbox", role: "BuyerAgent" },
      // Home warranty.
      warranty_does: { label: "warranty_does", type: "checkbox", role: "BuyerAgent" },
      warranty_does_not: { label: "warranty_does_not", type: "checkbox", role: "BuyerAgent" },
      warranty_paid_by_seller: { label: "warranty_paid_by_seller", type: "checkbox", role: "BuyerAgent" },
      warranty_paid_by_buyer: { label: "warranty_paid_by_buyer", type: "checkbox", role: "BuyerAgent" },
      warranty_max_amount: { label: "warranty_max_amount", type: "text", role: "BuyerAgent" },
      // Settlement / assignability.
      settlement_buyer: { label: "settlement_buyer", type: "checkbox", role: "BuyerAgent" },
      settlement_seller: { label: "settlement_seller", type: "checkbox", role: "BuyerAgent" },
      settlement_split: { label: "settlement_split", type: "checkbox", role: "BuyerAgent" },
      assignable_is: { label: "assignable_is", type: "checkbox", role: "BuyerAgent" },
      assignable_is_not: { label: "assignable_is_not", type: "checkbox", role: "BuyerAgent" },
      buyer_assigns: { label: "buyer_assigns", type: "checkbox", role: "BuyerAgent" },
      buyer_does_not_assign: { label: "buyer_does_not_assign", type: "checkbox", role: "BuyerAgent" },
      // Effective date (page 13).
      effective_date: { label: "effective_date", type: "text", role: "BuyerAgent" },
    },
  },
];

export function committedForm(key: string): ContractForm | undefined {
  return CONTRACT_FORMS.find((f) => f.key === key);
}
