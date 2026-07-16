-- Revert to the 000014 allowlist. Any rows already at 'refunded' would violate the
-- old constraint, so normalize them to 'unpaid' before re-adding the narrower CHECK.
UPDATE deals SET fee_status = 'unpaid' WHERE fee_status = 'refunded';
ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_fee_status_check;
ALTER TABLE deals ADD CONSTRAINT deals_fee_status_check
  CHECK (fee_status IN ('unpaid','pending','paid','waived'));
