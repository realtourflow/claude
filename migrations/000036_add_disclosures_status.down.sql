ALTER TABLE deals
  DROP COLUMN IF EXISTS disclosures_updated_at,
  DROP COLUMN IF EXISTS disclosures_source,
  DROP COLUMN IF EXISTS disclosures_complete;
