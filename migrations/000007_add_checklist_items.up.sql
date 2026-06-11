CREATE TYPE checklist_assignee AS ENUM ('tc', 'agent', 'buyer', 'seller', 'third_party');

CREATE TABLE checklist_items (
    id          UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id     UUID                 NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    label       TEXT                 NOT NULL,
    category    TEXT                 NOT NULL DEFAULT 'Contract',
    checked     BOOLEAN              NOT NULL DEFAULT FALSE,
    assigned_to checklist_assignee   NOT NULL DEFAULT 'tc',
    due_date    DATE,
    is_custom   BOOLEAN              NOT NULL DEFAULT FALSE,
    sort_order  INTEGER              NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_checklist_items_deal_id ON checklist_items(deal_id);
