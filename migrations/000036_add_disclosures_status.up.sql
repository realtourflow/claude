-- Disclosures are TRACKED, never sent from RTF (the lender sends them
-- out-of-band; the disclosure-packet send path is removed in the same build).
-- source: 'manual' for now; ARIVE will write 'arive' when its sync feeds this
-- in v2.
ALTER TABLE deals
  ADD COLUMN disclosures_complete BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN disclosures_source TEXT NOT NULL DEFAULT '',
  ADD COLUMN disclosures_updated_at TIMESTAMPTZ;
