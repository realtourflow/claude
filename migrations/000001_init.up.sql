-- Migration: 001_init
-- Created: 2026-04-29

BEGIN;

CREATE TYPE user_role AS ENUM ('agent', 'buyer', 'seller', 'admin', 'lending_partner');

CREATE TYPE deal_stage AS ENUM (
  'intake',
  'active_search',
  'offer_active',
  'under_contract',
  'pre_close',
  'closing',
  'post_close'
);

CREATE TYPE deal_type AS ENUM ('buy', 'sell');

CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'completed', 'skipped');

CREATE TABLE users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth0_id   TEXT NOT NULL UNIQUE,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  role       user_role NOT NULL,
  phone      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE deals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     UUID NOT NULL REFERENCES users(id),
  type         deal_type NOT NULL,
  stage        deal_stage NOT NULL DEFAULT 'intake',
  title        TEXT NOT NULL,
  address      TEXT,
  price        NUMERIC(12, 2),
  arive_linked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE deal_participants (
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    user_role NOT NULL,
  PRIMARY KEY (deal_id, user_id)
);

CREATE TABLE deal_stage_history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id    UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  from_stage deal_stage,
  to_stage   deal_stage NOT NULL,
  changed_by UUID NOT NULL REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES users(id),
  title       TEXT NOT NULL,
  description TEXT,
  status      task_status NOT NULL DEFAULT 'pending',
  due_date    DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  s3_key      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id    UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  sender_id  UUID NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deals_agent_id       ON deals(agent_id);
CREATE INDEX idx_deals_stage          ON deals(stage);
CREATE INDEX idx_tasks_deal_id        ON tasks(deal_id);
CREATE INDEX idx_tasks_assigned_to    ON tasks(assigned_to);
CREATE INDEX idx_messages_deal_id     ON messages(deal_id);
CREATE INDEX idx_participants_user_id ON deal_participants(user_id);

COMMIT;
