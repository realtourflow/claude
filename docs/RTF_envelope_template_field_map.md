# RealTourFlow — DocuSign Envelope Template Field Map (canonical)

Source of truth for the contract-form **Data Labels + roles**, transcribed from
`RTF_Envelope_Template_Build_Spec.pdf` (June 2026). The code registry
(`web/lib/contract-forms.ts`) is wired from this; when they disagree, **this wins**
and the code is corrected to match.

## How a form goes live
1. Build it in DocuSign as an **Envelope Template** (the eSignature API only reads
   these — *not* "Document Templates").
2. Add recipients as **roles** with name/email left blank; place each field; set its
   **Data Label** to the key below.
3. Save, copy the template **GUID** from the URL, hand it to Code.
4. Code adds it to `DOCUSIGN_TEMPLATE_IDS` env → the form is live (no code change).

## Build rules (do not skip — these are what make prefill work)
- **Prefilled fields must be `Text` or `Checkbox` tabs.** The app fills only those
  two tab types. A field the spec calls "Date" or "Number" that the **app fills**
  (closing date, % , days) must still be built as a **Text** tab — a Date/Number tab
  will NOT receive the value. Dates are sent as `MM/DD/YYYY` text.
- **Signature / Initial / Date Signed** carry **no** Data Label — they're owned by
  the role.
- **Role names matter exactly** — `Buyer1`, `Seller1`, `Agent`, `Listing Agent`,
  `Listing Licensee`, `Consumer`, etc. The send maps a deal's buyer/seller/agent to
  these by name.
- A **Data Label can prefill on only one role.** If the same label appears on two
  roles (a body line and a print line), only the primary one auto-fills.

## Auto-fill vs agent-entered
- **Auto-filled from the deal:** `buyer_name`, `agent_name`, `brokerage_name`, and any
  key that exactly matches a core fact (`purchase_price`, `closing_date`,
  `legal_description`, `earnest_money_amount`, …).
- **Agent-entered (prep step):** everything else, incl. `seller_name`,
  `property_city`/`property_zip`/`ppin`/`loan_amount`/`effective_date` (these don't
  match the fact names yet, so they aren't auto-sourced — see the TODO in
  `contract-forms.ts`).

---

## Forms

### 1. Wire Fraud Prevention Notice — roles `Consumer1` (req) · `Consumer2` (opt) · all markets
`brokerage_name`·`consumer_name` (Consumer1) · `consumer_name_2` (Consumer2). Sig+Date per consumer.
*Consumer-routed → wired on the wire-fraud branch, not the main registry.*

### 2. Real Estate Brokerage Services Disclosure (AREC) — roles `Agent` · `Consumer` · all markets
`agent_name` (Agent) · `consumer_name` (Consumer). Sig+Date per role.
*Consumer-routed → wired on the wire-fraud branch.*

### 3. Documentation Fee (RE/MAX only) — roles `Signer` (+ opt `Signer2`)
`property_address` (Signer). Initials + Sig per signer. **RE/MAX agents only.**
*Consumer/brokerage-scoped → wired on the wire-fraud branch.*

### 4. Lead-Based Paint Disclosure — roles `Seller1`·`Seller2`(opt)·`Buyer1`·`Buyer2`(opt)·`Agent` · federal/all markets
| Data Label | Type | Role |
|---|---|---|
| property_address | Text | Seller1 |
| lead_paint_known_present | Checkbox | Seller1 |
| lead_paint_no_knowledge | Checkbox | Seller1 |
| lead_paint_explanation | Text | Seller1 |
| lead_paint_records_provided | Checkbox | Seller1 |
| lead_paint_no_records | Checkbox | Seller1 |
| lead_paint_records_list | Text | Seller1 |
| lead_paint_inspection_opportunity | Checkbox | Buyer1 |
| lead_paint_inspection_waived | Checkbox | Buyer1 |

Page 2 Certification: Sig+Date for Buyer1/Buyer2/Seller1/Seller2/Agent. Skip the page-2 Lessor section (rentals).

### 5. Inspection Addendum (ValleyMLS) — roles `Buyer1–3` · `Seller1–3` · witnesses = plain text
| Data Label | Type | Role |
|---|---|---|
| buyer_name | Text | Buyer1 |
| seller_name | Text | Seller1 |
| property_address | Text | Buyer1 |
| property_city | Text | Buyer1 |
| property_county | Text | Buyer1 |
| property_state | Text | Buyer1 |
| property_zip | Text | Buyer1 |
| inspection_notice_days | Text (spec: Number) | Buyer1 |
| inspection_additional_provisions | Text (multi) | Buyer1 |
| addendum_date | Text | Buyer1 |

Sig+Date per Buyer/Seller. The 6 witness lines = plain text, no role.

### 6. Addendum — Contingent on Sale of Buyer's Property (Baldwin) — roles `Buyer1`·`Buyer2`(opt)·`Seller1`·`Seller2`(opt)
| Data Label | Type | Role |
|---|---|---|
| addendum_number | Text | Buyer1 |
| effective_date | Text (spec: Date) | Buyer1 |
| property_address | Text | Buyer1 |
| seller_name | Text | Buyer1 |
| buyer_name | Text | Buyer1 |
| buyer_property_address | Text | Buyer1 |
| buyer_property_for_sale | Checkbox | Buyer1 |
| listing_broker_name | Text | Buyer1 |
| buyer_property_under_contract | Checkbox | Buyer1 |
| backup_response_hours | Text (spec: Number) | Buyer1 |
| buyer_property_close_by_date | Text (spec: Date) | Buyer1 |
| addendum_additional_terms | Text (multi) | Buyer1 |

Print names + Sig+Date: Buyer1/Buyer2 (`buyer_name`/`buyer_name_2`), Seller1/Seller2 (`seller_name`/`seller_name_2`).

### 7. Buyer Agency Agreement (Baldwin) — roles `Buyer1`·`Buyer2`(opt)·`Agent`
> ⚠️ The earlier-built BAA template (`863df439`) uses the OLD label scheme. **Rebuild
> per this spec.** Code relabel lands when the rebuilt GUID is handed over.

| Data Label | Type | Role |
|---|---|---|
| buyer_name | Text | Buyer1 |
| agent_name | Text | Agent |
| qualifying_broker | Text | Agent |
| brokerage_name | Text | Agent |
| agreement_start_date | Text (spec: Date) | Buyer1 |
| agreement_end_date | Text (spec: Date) | Buyer1 |
| comp_flat | Text | Buyer1 |
| comp_percent | Text | Buyer1 |
| comp_other | Text | Buyer1 |
| baa_tail_days | Text (spec: Number) | Buyer1 |
| referral_fee_applies | Checkbox | Buyer1 |
| referral_fee_percent | Text | Buyer1 |
| disclose_identity | Checkbox | Buyer1 |
| property_preferences | Text | Buyer1 |
| buyer_mailing_address / buyer_city_state_zip / buyer_phone / buyer_email | Text | Buyer1 |
| agent_mailing_address / agent_city_state_zip / agent_phone / agent_email | Text | Agent |

Initials (Buyer1) on pg 1 + para 5. Sig+Date: Agent, Buyer1, Buyer2.

### 8. Baldwin Listing Agreement (Exclusive Right to Sell) — roles `Seller1–4` · `Listing Agent` · 17 pages
**Core:** `seller_name`(S1) · `brokerage_name`(LA) · `property_address/city/county/state/zip`(S1) ·
`legal_description`·`ppin`(S1) · `agreement_start_date`·`agreement_end_date`(S1) · `purchase_price`(S1, listing price) ·
`comp_percent`·`comp_flat`(S1) · `protection_period_days`(S1).
**Checkboxes (S1):** `dual_agency_authorized` · `listing_terms` · `home_warranty` · `termite_prior_infestation` ·
`termite_under_contract` · `has_survey` · `has_elevation_cert` · `lockbox_authorized` · `onetime_code_ok` ·
`is_rental` · `title_type` · `has_poa` · `furnishings`.
**Sigs:** Seller1–4 + `agent_name`(LA print). `Seller's Initials` on EVERY page (Seller1).
**Land/Lot variant:** same core, fewer condition checkboxes (`baldwin_listing_agreement_land`).

### 9. FORM 300 — Birmingham General/Financed Residential Contract — roles `Buyer1–2`·`Seller1–2`·`Listing Licensee` · 13 pages
**Core:** `buyer_name`(B1)·`seller_name`(S1) · `property_city/county/address/zip`(B1) · `legal_description`·`ppin`·`mls_id`(B1) ·
`purchase_price`·`earnest_money_amount`(B1) · `loan_amount`(B1) · `closing_date`(B1) · `effective_date`(Listing Licensee).
**Elections:** `listing_agency_role`·`selling_agency_role`·`purchase_money_type`·`loan_type`(cb) · `loan_percent`·`finance_application_days` ·
`appraisal_contingency`(cb) · `seller_concession_amount` · `buyer_sale_contingency`(cb) · `condition_option`(cb) ·
`inspection_period_days` · `lead_paint_attached`(cb) · `home_warranty`(cb).
**Agent block (Listing Licensee):** `agent_name`·`brokerage_name`·`agent_email`·`agent_phone`.
**Sigs:** Buyer1/2, Seller1/2, Listing Licensee. Buyer + Seller Initials on EVERY page.

---

*Build order: 1–7 first (fast), then 8 + 9 (the monsters). After each: Save & Close → copy GUID → hand to Code.*
