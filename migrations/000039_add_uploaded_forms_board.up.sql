-- Market identity for uploaded forms (form-upload pipeline). Captured at upload,
-- defaulting to the uploading agent's market. Unused until promote-to-all
-- (step 6), where the agent-forms resolver reuses the committed-form market
-- filter — board = '' OR board = the viewing agent's market — so a promoted
-- uploaded form routes by market identically to a hand-built one. '' = universal.
ALTER TABLE uploaded_forms ADD COLUMN board TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_uploaded_forms_board ON uploaded_forms(board);
