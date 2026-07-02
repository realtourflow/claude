-- Restore the global promoted flag + its visibility index. Combo promotions are
-- collapsed: any form with at least one promotion becomes globally promoted.
ALTER TABLE uploaded_forms ADD COLUMN promoted BOOLEAN NOT NULL DEFAULT false;
UPDATE uploaded_forms SET promoted = true
  WHERE id IN (SELECT DISTINCT form_id FROM form_promotions);
CREATE INDEX idx_uploaded_forms_visibility ON uploaded_forms(status, promoted, agent_id);

DROP TABLE form_promotions;
DROP TABLE brokerages;

ALTER TABLE users DROP COLUMN markets;
