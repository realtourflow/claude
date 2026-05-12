CREATE TABLE net_sheets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id       UUID NOT NULL UNIQUE REFERENCES deals(id) ON DELETE CASCADE,
  sale_price    INTEGER NOT NULL DEFAULT 0,
  closing_date  DATE,
  annual_taxes  INTEGER NOT NULL DEFAULT 0,
  lines         JSONB NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'draft',
  ready_at      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
