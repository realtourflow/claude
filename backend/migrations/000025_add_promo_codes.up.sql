CREATE TABLE IF NOT EXISTS promo_codes (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT        NOT NULL UNIQUE,
  discount_type TEXT        NOT NULL CHECK (discount_type IN ('pct', 'fixed')),
  discount_value NUMERIC    NOT NULL,
  applies_to    TEXT[]      NOT NULL DEFAULT '{}',
  max_uses      INT,
  uses_count    INT         NOT NULL DEFAULT 0,
  expires_at    TIMESTAMPTZ,
  created_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
