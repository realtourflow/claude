-- Combined-PDF bundles: an agent can upload one PDF holding several forms; the
-- admin carves it into individual forms by page range in Form Review.
--   status 'pending_split' — the bundle is awaiting the admin's page-split.
--   status 'split'         — the bundle has been carved (archived); its children
--                            are the real forms and go through normal review.
--   detection_source 'bundle' — marks the un-split combined PDF (no field detection).
ALTER TABLE uploaded_forms DROP CONSTRAINT uploaded_forms_status_check;
ALTER TABLE uploaded_forms ADD CONSTRAINT uploaded_forms_status_check
  CHECK (status IN ('pending_review', 'ready', 'rejected', 'archived', 'detecting', 'pending_split', 'split'));

ALTER TABLE uploaded_forms DROP CONSTRAINT uploaded_forms_detection_source_check;
ALTER TABLE uploaded_forms ADD CONSTRAINT uploaded_forms_detection_source_check
  CHECK (detection_source IN ('acroform', 'recognized', 'vision', 'bundle'));
