-- Brokerage on the agent profile. Free text (onboarding offers common
-- brokerages + "Other"). Informational: Paul references it manually to wire
-- brokerage-specific DocuSign forms (e.g. RE/MAX doc-fee). No brokerage→form
-- automation — that is v2. (users.market already exists from 000035 and drives
-- board-form visibility.)
ALTER TABLE users ADD COLUMN brokerage TEXT NOT NULL DEFAULT '';
