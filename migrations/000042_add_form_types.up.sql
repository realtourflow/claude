-- Document TYPES (Layer 2 of the form pipeline): a position-FREE field set per
-- document class (purchase agreement, listing agreement, lead-paint disclosure …).
-- A TYPE names the fields ANY brokerage's version of that document needs — mapped
-- to auto-fill core keys where they apply — INDEPENDENT of layout. On upload the
-- agent PICKS the type; guided vision then locates the type's field set on the
-- agent's specific layout. A known_form (a specific reviewed layout, table
-- known_forms) realizes exactly one type. Additive: the committed v1 registry and
-- the known_forms catalog are untouched.
CREATE TABLE form_types (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable machine key the upload UI + seeds reference (e.g. 'purchase_agreement').
  key           TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  side          TEXT NOT NULL DEFAULT 'both' CHECK (side IN ('buy', 'sell', 'both')),

  -- The position-FREE field set: one object per field —
  --   { label, type, role, tier ('core'|'common'), core_key, required, source, note }
  -- NO coordinates: positions are layout-specific and come from recognition or
  -- guided vision per upload. core_key ties a field to the auto-fill registry
  -- (lib/form-ai/core-keys); tier ranks how universal the field is across layouts.
  field_set     JSONB NOT NULL DEFAULT '[]'::jsonb,
  field_count   INT  NOT NULL DEFAULT 0,

  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A known form (a specific reviewed layout) realizes one document type. SET NULL
-- so deleting a type just unlinks its layouts — each keeps its own verified field
-- map (matches the SET-NULL provenance pointers already on known_forms).
ALTER TABLE known_forms
  ADD COLUMN type_id UUID REFERENCES form_types(id) ON DELETE SET NULL;
CREATE INDEX idx_known_forms_type_id ON known_forms(type_id);
