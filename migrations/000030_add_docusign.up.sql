ALTER TABLE documents ADD COLUMN IF NOT EXISTS docusign_envelope_id TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS docusign_status TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS docusign_sent_at TIMESTAMPTZ;
