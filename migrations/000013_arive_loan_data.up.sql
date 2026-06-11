ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS arive_loan_id    TEXT,
  ADD COLUMN IF NOT EXISTS arive_milestones JSONB,
  ADD COLUMN IF NOT EXISTS arive_key_dates  JSONB,
  ADD COLUMN IF NOT EXISTS arive_loan_status TEXT,
  ADD COLUMN IF NOT EXISTS arive_synced_at  TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_arive_loan_id
  ON deals (arive_loan_id)
  WHERE arive_loan_id IS NOT NULL;
