ALTER TABLE deals
  DROP COLUMN IF EXISTS pre_approved,
  DROP COLUMN IF EXISTS baa_signed;
