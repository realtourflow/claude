-- Agent self-serve form upload + AI field-mapping pipeline (v2).
--
-- PURELY ADDITIVE. This does not touch the committed form registry
-- (lib/contract-forms.ts), the env template config (DOCUSIGN_TEMPLATE_IDS /
-- DOCUSIGN_TEMPLATES), or any wired form. It introduces a third, DB-backed
-- source of sendable forms that an agent uploads, an AI proposes a mapping for,
-- and an admin must approve before it can ever touch a live deal.
--
-- Once a row reaches status='ready' it carries the SAME resolved shape the
-- existing pipeline already consumes (templateId + role_mapping + routing +
-- consumer_roles + field_map + purpose), so the send/sign path (routing,
-- buildPrefillTabs, sendTemplateEnvelope, embedded signing, webhook, archive)
-- is reused unchanged.

-- uploaded_forms: one row per agent-uploaded blank form + its lifecycle.
CREATE TABLE uploaded_forms (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Owner. The ONLY agent who can use this form unless an admin promotes it.
  agent_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label                 TEXT NOT NULL,

  -- Which deal side the form serves (drives the picker + default routing).
  -- 'both' = universal (e.g. a statewide notice signed on buy and sell deals).
  side                  TEXT NOT NULL DEFAULT 'both'
                          CHECK (side IN ('buy', 'sell', 'both')),

  -- Lifecycle. The review gate: a form is unusable on a live deal until an admin
  -- moves it to 'ready'. TEXT+CHECK mirrors fee_status / docusign_status style.
  status                TEXT NOT NULL DEFAULT 'pending_review'
                          CHECK (status IN ('pending_review', 'ready', 'rejected', 'archived')),

  -- The uploaded blank PDF (the source artifact). Namespaced in S3 under
  -- agent-forms/{agentId}/{timestamp}/{filename}. The original is never mutated.
  source_s3_key         TEXT NOT NULL,
  source_file_name      TEXT NOT NULL,
  mime_type             TEXT NOT NULL DEFAULT 'application/pdf',
  file_size             BIGINT NOT NULL DEFAULT 0,
  -- SHA-256 of the exact bytes the agent attested to. Ties the attestation to
  -- this specific file for the audit trail.
  file_sha256           TEXT NOT NULL DEFAULT '',

  -- Licensing attestation: who checked the box, when, and the exact wording they
  -- agreed to. Required at upload (enforced in the route). "Which file" = this
  -- row's source_s3_key + file_sha256.
  attested_by           UUID NOT NULL REFERENCES users(id),
  attested_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  attestation_statement TEXT NOT NULL DEFAULT '',

  -- Set ONLY once approved + created in DocuSign via the Templates API. NULL
  -- until 'ready'. This is the env-equivalent templateId for committed forms.
  docusign_template_id  TEXT,

  -- Resolved send-config — same shapes as lib/contract-forms ContractForm so the
  -- existing resolver/send path can consume it verbatim:
  --   role_mapping   : deal participant role -> template role (by-role mode)
  --   routing        : 'by-role' | 'consumers'
  --   consumer_roles : ordered template role names (consumers mode)
  --   field_map      : coreKey -> { label, type, role }  (drives prefill)
  --   purpose        : '' | 'baa' (kept open for parity with documents.purpose)
  role_mapping          JSONB NOT NULL DEFAULT '{}'::jsonb,
  routing               TEXT NOT NULL DEFAULT 'by-role'
                          CHECK (routing IN ('by-role', 'consumers')),
  consumer_roles        JSONB NOT NULL DEFAULT '[]'::jsonb,
  field_map             JSONB NOT NULL DEFAULT '{}'::jsonb,
  purpose               TEXT NOT NULL DEFAULT '',

  -- Visibility. false = owner agent only; true = admin promoted to all agents.
  promoted              BOOLEAN NOT NULL DEFAULT false,

  -- Review audit (the human gate).
  reviewed_by           UUID REFERENCES users(id),
  reviewed_at           TIMESTAMPTZ,
  review_notes          TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_uploaded_forms_agent_id ON uploaded_forms(agent_id);
CREATE INDEX idx_uploaded_forms_status ON uploaded_forms(status);
-- Picker lookup: ready forms visible to a given agent (own or promoted).
CREATE INDEX idx_uploaded_forms_visibility ON uploaded_forms(status, promoted, agent_id);

-- uploaded_form_fields: one row per detected field. The review surface — it
-- carries the deterministic extraction, the AI proposal, and the human decision
-- side by side. The approved (final_*) values are assembled into the parent's
-- field_map + the DocuSign template tabs at approval time.
CREATE TABLE uploaded_form_fields (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id         UUID NOT NULL REFERENCES uploaded_forms(id) ON DELETE CASCADE,

  -- Deterministic extraction (pdf-lib AcroForm widget). Position is kept so the
  -- DocuSign template tab can be placed exactly where the field is.
  detected_name   TEXT NOT NULL,
  detected_type   TEXT NOT NULL DEFAULT 'text'
                    CHECK (detected_type IN ('text', 'checkbox', 'signature', 'initial', 'date', 'unknown')),
  page_number     INT NOT NULL DEFAULT 1,
  pos_x           NUMERIC NOT NULL DEFAULT 0,
  pos_y           NUMERIC NOT NULL DEFAULT 0,
  width           NUMERIC NOT NULL DEFAULT 0,
  height          NUMERIC NOT NULL DEFAULT 0,
  -- Text near the field (label/caption) — context for the AI and the reviewer.
  nearby_text     TEXT NOT NULL DEFAULT '',

  -- AI proposal (provider behind a swappable interface). ai_core_key NULL = the
  -- AI declined to map it (an explicit "I don't know", never a guess).
  ai_core_key     TEXT,
  ai_role         TEXT,
  ai_confidence   NUMERIC,
  ai_rationale    TEXT NOT NULL DEFAULT '',
  -- Low confidence or unmapped => surfaced as "needs human review".
  needs_review    BOOLEAN NOT NULL DEFAULT true,

  -- Human decision (admin review screen). final_core_key NULL = intentionally
  -- left unmapped (a blank tab the signer fills). decision records how it landed.
  final_core_key  TEXT,
  final_role      TEXT,
  final_type      TEXT,
  decision        TEXT NOT NULL DEFAULT 'pending'
                    CHECK (decision IN ('pending', 'accepted', 'corrected', 'skipped')),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_uploaded_form_fields_form_id ON uploaded_form_fields(form_id);
