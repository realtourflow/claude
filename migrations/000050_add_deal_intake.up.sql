-- #175 — persist buyer/seller onboarding questionnaires.
-- The intake JSON lives on the deal itself (no new table / access-control
-- surface): { role: 'buyer'|'seller', submitted_at: ISO timestamp, answers: {...} }.
ALTER TABLE deals ADD COLUMN intake JSONB;
