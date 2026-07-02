-- Reverting: any bundle rows must be gone first or the tighter CHECK will fail.
DELETE FROM uploaded_forms WHERE status IN ('pending_split', 'split') OR detection_source = 'bundle';

ALTER TABLE uploaded_forms DROP CONSTRAINT uploaded_forms_detection_source_check;
ALTER TABLE uploaded_forms ADD CONSTRAINT uploaded_forms_detection_source_check
  CHECK (detection_source IN ('acroform', 'recognized', 'vision'));

ALTER TABLE uploaded_forms DROP CONSTRAINT uploaded_forms_status_check;
ALTER TABLE uploaded_forms ADD CONSTRAINT uploaded_forms_status_check
  CHECK (status IN ('pending_review', 'ready', 'rejected', 'archived', 'detecting'));
