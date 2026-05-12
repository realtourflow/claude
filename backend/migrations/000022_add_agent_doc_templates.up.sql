CREATE TABLE IF NOT EXISTS agent_doc_templates (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  doc_type   TEXT        NOT NULL,
  file_name  TEXT        NOT NULL,
  s3_key     TEXT        NOT NULL,
  mime_type  TEXT        NOT NULL DEFAULT 'application/octet-stream',
  file_size  BIGINT      NOT NULL DEFAULT 0,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_doc_templates_agent_id ON agent_doc_templates(agent_id);
