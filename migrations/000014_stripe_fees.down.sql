ALTER TABLE deals
  DROP COLUMN IF EXISTS fee_paid_at,
  DROP COLUMN IF EXISTS fee_checkout_session_id,
  DROP COLUMN IF EXISTS fee_amount_cents,
  DROP COLUMN IF EXISTS fee_status;
