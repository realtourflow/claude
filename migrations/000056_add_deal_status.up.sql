-- #254: give deals a lifecycle end. Until now a deal was immortal — no archive,
-- no "fallen through"; dead deals sat in the pipeline forever, polluting counts,
-- dashboards, and the TC view. Add a soft-lifecycle status column so the owning
-- agent can archive a deal or mark it fallen-through without a hard delete
-- (stage history, docs, and audit rows all survive). Existing rows all become
-- 'active' via the default (no backfill needed). Default deal lists exclude
-- non-active deals unless a ?status= filter is passed; archived deals stay
-- readable by direct GET.
ALTER TABLE deals ADD COLUMN status text NOT NULL DEFAULT 'active';
ALTER TABLE deals ADD CONSTRAINT deals_status_check CHECK (status IN ('active','archived','fallen_through'));
