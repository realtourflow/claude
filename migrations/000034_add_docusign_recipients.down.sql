ALTER TABLE documents
  DROP COLUMN IF EXISTS purpose,
  DROP COLUMN IF EXISTS docusign_completed_at,
  DROP COLUMN IF EXISTS docusign_signed_s3_key;

DROP TABLE IF EXISTS docusign_recipients;
