-- Per-recipient DocuSign tracking + template-send support.
--
-- docusign_recipients: one row per envelope recipient, written at send time.
-- Snapshot email/name (the envelope is immutable; user profiles drift).
-- client_user_id set => embedded signer (no DocuSign email); NULL => email
-- recipient (hybrid model for signers without portal accounts).
CREATE TABLE docusign_recipients (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  envelope_id    TEXT NOT NULL,
  user_id        UUID REFERENCES users(id),
  email          TEXT NOT NULL,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT '',
  recipient_id   TEXT NOT NULL,
  routing_order  INT  NOT NULL DEFAULT 1,
  client_user_id TEXT,
  status         TEXT NOT NULL DEFAULT 'sent',
  signed_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, recipient_id)
);

CREATE INDEX idx_docusign_recipients_envelope ON docusign_recipients(envelope_id);
CREATE INDEX idx_docusign_recipients_user ON docusign_recipients(user_id);

-- documents:
--  - docusign_signed_s3_key: the completed/combined signed PDF (Phase 3 fills
--    it). Never overwrites s3_key — the unsigned original stays the source
--    artifact. Template sends create the row with s3_key='' (no upload), so
--    the signed copy becomes the only artifact.
--  - purpose: '' | 'baa' — marks special documents (BAA completion flips
--    deals.baa_signed via the webhook in a later phase).
ALTER TABLE documents
  ADD COLUMN docusign_signed_s3_key TEXT,
  ADD COLUMN docusign_completed_at TIMESTAMPTZ,
  ADD COLUMN purpose TEXT NOT NULL DEFAULT '';
