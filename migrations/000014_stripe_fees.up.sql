ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS fee_status             TEXT NOT NULL DEFAULT 'unpaid'
                                                  CHECK (fee_status IN ('unpaid','pending','paid','waived')),
  ADD COLUMN IF NOT EXISTS fee_amount_cents        INT  NOT NULL DEFAULT 7500,
  ADD COLUMN IF NOT EXISTS fee_checkout_session_id TEXT,
  ADD COLUMN IF NOT EXISTS fee_paid_at             TIMESTAMPTZ;
