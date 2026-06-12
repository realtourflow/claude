-- Contract-fill engine (Stage 1, Build A).
--
-- market: which association/board an agent belongs to (BIRMINGHAM_AAR,
-- BALDWIN_GULF_COAST, ...). Deals inherit the agent's market at creation;
-- it drives which board-keyed contract forms are visible/sendable.
ALTER TABLE users ADD COLUMN market TEXT NOT NULL DEFAULT '';
ALTER TABLE deals ADD COLUMN market TEXT NOT NULL DEFAULT '';

-- Shared contract facts, one row per deal (1:1). These are the core terms
-- every purchase contract needs regardless of board; board-specific extras
-- live in deal_contract_terms. Parties + agent/brokerage info already exist
-- on deals/users/deal_participants — never duplicated here.
CREATE TABLE deal_contract_facts (
  deal_id                  UUID PRIMARY KEY REFERENCES deals(id) ON DELETE CASCADE,
  legal_description        TEXT NOT NULL DEFAULT '',
  parcel_or_ppin           TEXT NOT NULL DEFAULT '',
  city                     TEXT NOT NULL DEFAULT '',
  state                    TEXT NOT NULL DEFAULT '',
  zip                      TEXT NOT NULL DEFAULT '',
  purchase_price           NUMERIC(12,2),
  earnest_money_amount     NUMERIC(12,2),
  earnest_money_holder     TEXT NOT NULL DEFAULT '',
  financing_type           TEXT NOT NULL DEFAULT '',
  loan_amount_or_pct       TEXT NOT NULL DEFAULT '',
  offer_date               DATE,
  acceptance_binding_date  DATE,
  closing_date             DATE,
  possession               TEXT NOT NULL DEFAULT '',
  buyer_broker_comp        TEXT NOT NULL DEFAULT '',
  agency_role              TEXT NOT NULL DEFAULT '',
  included_fixtures        JSONB NOT NULL DEFAULT '{}',
  additional_provisions    TEXT NOT NULL DEFAULT '',
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Board/form-specific values (checkboxes, day counts, caps...) per deal per
-- form, validated against the form's fieldMap at write time. JSON by design —
-- never one column per checkbox.
CREATE TABLE deal_contract_terms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  form_key    TEXT NOT NULL,
  terms       JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deal_id, form_key)
);
