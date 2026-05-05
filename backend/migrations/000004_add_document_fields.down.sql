ALTER TABLE documents
  DROP COLUMN IF EXISTS file_size,
  DROP COLUMN IF EXISTS mime_type;
