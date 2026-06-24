-- Recognition library (Layer 1 of the flat-PDF plan): a curated catalog of
-- verified forms. On upload, a form's AcroForm-structure fingerprint is matched
-- here; a hit copies the stored verified field map (exact positions + meaning)
-- into the agent's upload, skipping the AI mapper — but the form STILL passes
-- through the admin review gate. Additive; the committed v1 registry is untouched.
CREATE TABLE known_forms (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label         TEXT NOT NULL,
  side          TEXT NOT NULL DEFAULT 'both' CHECK (side IN ('buy', 'sell', 'both')),
  -- Market identity (reuses the committed board filter: '' = universal).
  board         TEXT NOT NULL DEFAULT '',
  purpose       TEXT NOT NULL DEFAULT '',

  -- AcroForm STRUCTURE fingerprint ("v1:"+sha256) — the exact-match lookup key.
  fingerprint   TEXT NOT NULL,
  field_count   INT  NOT NULL DEFAULT 0,
  page_count    INT  NOT NULL DEFAULT 0,

  -- The curated "answer key": one object per field —
  -- { detected_name, detected_type, effective_type, page_number, pos_x, pos_y,
  --   width, height, core_key, role, needs_review }. effective_type is the
  -- admin's approved type (drives the DocuSign tab); detected_type is the raw
  -- extractor type. Copied into uploaded_form_fields on a match.
  fields        JSONB NOT NULL DEFAULT '[]'::jsonb,
  role_mapping  JSONB NOT NULL DEFAULT '{}'::jsonb,

  active        BOOLEAN NOT NULL DEFAULT true,
  -- Provenance when promoted from an approved upload via "save as known".
  -- Both nullable + SET NULL so deleting the source form or author just nulls
  -- the pointer (matches promo_codes.created_by / audit_log.actor_id).
  source_form_id UUID REFERENCES uploaded_forms(id) ON DELETE SET NULL,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One catalog entry per (structure, market). Scoping by board lets two markets
-- carry structurally-identical forms; recognition then resolves exactly one in
-- the agent's market. Doubles as the fast lookup index (leading column).
CREATE UNIQUE INDEX idx_known_forms_fingerprint_board ON known_forms(fingerprint, board);

-- Audit on the agent upload: the structure hash we computed, and which catalog
-- entry it matched (if any).
ALTER TABLE uploaded_forms ADD COLUMN structure_sha256 TEXT NOT NULL DEFAULT '';
ALTER TABLE uploaded_forms
  ADD COLUMN recognized_from_known_form_id UUID REFERENCES known_forms(id) ON DELETE SET NULL;
