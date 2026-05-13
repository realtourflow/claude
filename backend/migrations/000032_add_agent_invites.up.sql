CREATE TABLE agent_invites (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT        NOT NULL,
    name        TEXT        NOT NULL DEFAULT '',
    token       TEXT        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
    invited_by  UUID        NOT NULL REFERENCES users(id),
    claimed_at  TIMESTAMPTZ,
    claimed_by  UUID        REFERENCES users(id),
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
