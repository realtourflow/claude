-- #264: persist a "checklist defaults were seeded" marker so an intentionally
-- emptied checklist stays empty. The GET /api/deals/[id]/checklist route used to
-- re-seed the 17 defaults whenever count === 0, so pruning every item (e.g. a
-- cash deal where none of the defaults apply) resurrected all 17 on the next
-- load — deletions silently undone. "Seeded before?" and "empty now?" are
-- different questions; this column answers the first. It is set exactly once, in
-- the same transaction as the createMany seed, and never cleared. NULL = the
-- defaults have never been seeded for this deal.
ALTER TABLE deals ADD COLUMN checklist_seeded_at timestamptz;

-- Backfill: stamp deals that already have checklist_items so existing lists
-- (including any already emptied-then-reseeded before this ships) keep their
-- current behavior and don't get re-seeded mid-flight. Idempotent + safe: it
-- only touches deals that already have items; deals with none stay NULL and
-- will seed on their first eligible-stage open.
UPDATE deals SET checklist_seeded_at = now()
WHERE id IN (SELECT DISTINCT deal_id FROM checklist_items);
