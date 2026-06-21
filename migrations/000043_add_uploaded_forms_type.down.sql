DROP INDEX IF EXISTS idx_uploaded_forms_form_type_id;
ALTER TABLE uploaded_forms DROP COLUMN IF EXISTS form_type_id;
