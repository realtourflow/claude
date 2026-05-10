CREATE TABLE deal_contingencies (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id           UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    label             TEXT NOT NULL,
    contingency_type  TEXT NOT NULL DEFAULT 'custom',
    deadline          DATE,
    waived_at         TIMESTAMPTZ,
    met_at            TIMESTAMPTZ,
    notes             TEXT,
    sort_order        INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON deal_contingencies (deal_id, sort_order);
