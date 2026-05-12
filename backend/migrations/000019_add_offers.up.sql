CREATE TABLE offers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id       UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  buyer_name    TEXT NOT NULL DEFAULT '',
  offer_price   INTEGER NOT NULL DEFAULT 0,
  close_date    DATE,
  contingencies TEXT[] NOT NULL DEFAULT '{}',
  agent_notes   TEXT NOT NULL DEFAULT '',
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
