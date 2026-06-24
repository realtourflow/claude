DROP INDEX IF EXISTS idx_known_forms_type_id;
ALTER TABLE known_forms DROP COLUMN IF EXISTS type_id;
DROP TABLE IF EXISTS form_types;
