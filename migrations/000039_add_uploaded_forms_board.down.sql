DROP INDEX IF EXISTS idx_uploaded_forms_board;
ALTER TABLE uploaded_forms DROP COLUMN IF EXISTS board;
