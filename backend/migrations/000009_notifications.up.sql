CREATE TABLE notifications (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    body       TEXT,
    type       TEXT NOT NULL DEFAULT 'info',
    deal_id    UUID REFERENCES deals(id) ON DELETE SET NULL,
    href       TEXT,
    read_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON notifications (user_id, created_at DESC);
