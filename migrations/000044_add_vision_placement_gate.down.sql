ALTER TABLE uploaded_forms DROP CONSTRAINT uploaded_forms_status_check;
ALTER TABLE uploaded_forms ADD CONSTRAINT uploaded_forms_status_check
  CHECK (status IN ('pending_review', 'ready', 'rejected', 'archived'));

ALTER TABLE uploaded_forms
  DROP COLUMN IF EXISTS placement_confirmed_by,
  DROP COLUMN IF EXISTS placement_confirmed_at,
  DROP COLUMN IF EXISTS detection_source;
