-- Phase 3 of the vision pipeline: guided vision detects fields on a NEW layout,
-- but its placements are AI guesses — so a human MUST verify them in a visual
-- overlay before the form can be used on a live deal. This adds the columns that
-- make that review a hard, unskippable gate.
--
-- detection_source records how a form's fields/positions were produced:
--   'acroform'   — exact AcroForm widget rects (deterministic, trusted)
--   'recognized' — copied from a verified known_forms catalog entry (trusted)
--   'vision'     — guided-vision guesses (MUST pass the placement overlay review)
-- The approve route refuses a 'vision' form until placement_confirmed_at is set;
-- since approve is the ONLY path to status='ready' (the send chokepoint in
-- lib/agent-forms.visibilityWhere), this gate cannot be bypassed.
ALTER TABLE uploaded_forms
  ADD COLUMN detection_source TEXT NOT NULL DEFAULT 'acroform'
    CHECK (detection_source IN ('acroform', 'recognized', 'vision')),
  ADD COLUMN placement_confirmed_at  TIMESTAMPTZ,
  ADD COLUMN placement_confirmed_by  UUID REFERENCES users(id) ON DELETE SET NULL;

-- 'detecting' = guided vision is running in the background; the form has no fields
-- yet and is not reviewable until detection completes (→ pending_review).
ALTER TABLE uploaded_forms DROP CONSTRAINT uploaded_forms_status_check;
ALTER TABLE uploaded_forms ADD CONSTRAINT uploaded_forms_status_check
  CHECK (status IN ('pending_review', 'ready', 'rejected', 'archived', 'detecting'));
