CREATE TABLE IF NOT EXISTS system_config (
  id         INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config     JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID        REFERENCES users(id) ON DELETE SET NULL
);

-- Seed default config
INSERT INTO system_config (id, config) VALUES (1, '{
  "stage_thresholds": {
    "intake": 5,
    "active_search": 30,
    "offer_active": 10,
    "under_contract": 35,
    "pre_close": 10,
    "closing": 5,
    "post_close": 21
  },
  "closing_fee_amount": 500,
  "fast_pass_base_price": 1500,
  "smooth_exit_pct": 1.0
}')
ON CONFLICT (id) DO NOTHING;
