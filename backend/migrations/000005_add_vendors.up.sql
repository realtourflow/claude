CREATE TABLE preferred_vendors (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category     VARCHAR(50) NOT NULL,
  company      TEXT NOT NULL,
  contact_name TEXT,
  phone        TEXT,
  email        TEXT,
  website      TEXT,
  notes        TEXT,
  is_featured  BOOLEAN NOT NULL DEFAULT false,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX preferred_vendors_agent_id_idx ON preferred_vendors(agent_id);
