CREATE TABLE deal_invites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id     UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    name        TEXT NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('buyer', 'seller')),
    token       UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    invited_by  UUID NOT NULL REFERENCES users(id),
    claimed_at  TIMESTAMPTZ,
    claimed_by  UUID REFERENCES users(id),
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON deal_invites (token);
CREATE INDEX ON deal_invites (email) WHERE claimed_at IS NULL;
