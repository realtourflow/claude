ALTER TABLE uploaded_forms DROP COLUMN IF EXISTS recognized_from_known_form_id;
ALTER TABLE uploaded_forms DROP COLUMN IF EXISTS structure_sha256;
DROP TABLE IF EXISTS known_forms;
