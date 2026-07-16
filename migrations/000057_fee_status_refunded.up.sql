-- #364 (umbrella #283): allow fee_status = 'refunded' so a refunded or disputed
-- closing fee stops showing as collected revenue forever. The original CHECK was
-- declared inline on the column in 000014_stripe_fees.up.sql, which Postgres names
-- deals_fee_status_check; a CHECK can't be edited in place, so drop and re-add it
-- with the extra value. (Disputes are recorded as 'refunded' too — product decision:
-- both mean the money is not settled revenue.)
ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_fee_status_check;
ALTER TABLE deals ADD CONSTRAINT deals_fee_status_check
  CHECK (fee_status IN ('unpaid','pending','paid','waived','refunded'));
