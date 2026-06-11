DROP INDEX IF EXISTS idx_deals_arive_loan_id;

ALTER TABLE deals
  DROP COLUMN IF EXISTS arive_synced_at,
  DROP COLUMN IF EXISTS arive_loan_status,
  DROP COLUMN IF EXISTS arive_key_dates,
  DROP COLUMN IF EXISTS arive_milestones,
  DROP COLUMN IF EXISTS arive_loan_id;
