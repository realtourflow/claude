-- Company & market selection + combo-scoped form promotions.
--
-- 1) users.markets — an agent can serve MULTIPLE markets. The existing
--    users.market column stays as the PRIMARY market (first pick): board-keyed
--    contract forms, uploaded_forms.board, and known-forms recognition key off it.
ALTER TABLE users ADD COLUMN markets JSONB NOT NULL DEFAULT '[]'::jsonb;
UPDATE users SET markets = jsonb_build_array(market) WHERE market <> '';

-- 2) brokerages — the company dropdown, DB-backed so the admin can approve
--    agent-suggested ("Other") entries into the list for future agents.
--    status: 'active' (in the dropdown) | 'pending' (awaiting admin review)
--          | 'rejected' (reviewed, not added).
CREATE TABLE brokerages (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL UNIQUE,
  status       TEXT        NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'pending', 'rejected')),
  suggested_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_brokerages_status ON brokerages(status);

-- Seed: the previously hardcoded onboarding list + ARC Realty.
INSERT INTO brokerages (name) VALUES
  ('ARC Realty'),
  ('Keller Williams'),
  ('RE/MAX'),
  ('Coldwell Banker'),
  ('eXp Realty'),
  ('Compass'),
  ('Century 21'),
  ('Berkshire Hathaway HomeServices'),
  ('Independent');

-- 3) form_promotions — a promotion is ALWAYS one company + one market together.
--    An agent whose profile matches (brokerage = combo.brokerage AND combo.market
--    is in their markets array) sees the form automatically — including agents
--    who onboard later. Replaces the global uploaded_forms.promoted flag.
CREATE TABLE form_promotions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id    UUID        NOT NULL REFERENCES uploaded_forms(id) ON DELETE CASCADE,
  brokerage  TEXT        NOT NULL,
  market     TEXT        NOT NULL,
  created_by UUID        NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (form_id, brokerage, market)
);
CREATE INDEX idx_form_promotions_combo ON form_promotions(brokerage, market);

-- 4) Retire the global promoted flag (its composite index goes with it).
ALTER TABLE uploaded_forms DROP COLUMN promoted;
