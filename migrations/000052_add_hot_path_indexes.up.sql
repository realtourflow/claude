-- #90 (FF10): indexes for hot query paths + a backstop against the checklist
-- auto-seed race.

-- 1. Dedup non-custom checklist items BEFORE creating the unique index.
--    The GET /api/deals/:id/checklist count-then-createMany race has been live,
--    so production may already hold double-seeded default rows. Keep the
--    earliest row per (deal_id, label); tie-break on id so the delete is
--    deterministic. (Irreversible — the down migration cannot restore these.)
DELETE FROM checklist_items a
USING checklist_items b
WHERE a.deal_id = b.deal_id
  AND a.label = b.label
  AND NOT a.is_custom
  AND NOT b.is_custom
  AND (b.created_at < a.created_at
       OR (b.created_at = a.created_at AND b.id < a.id));

-- 2. Backstop: a deal can hold each default (non-custom) item only once.
--    Custom items are exempt — agents may add duplicate labels on purpose.
CREATE UNIQUE INDEX idx_checklist_items_deal_label_default
  ON checklist_items (deal_id, label)
  WHERE NOT is_custom;

-- 3. Deal health on GET /api/deals runs a correlated
--    "ORDER BY changed_at DESC LIMIT 1" subquery per deal row (web/lib/deals.ts).
--    The composite index serves both that subquery and plain deal_id lookups.
CREATE INDEX idx_deal_stage_history_deal_changed
  ON deal_stage_history (deal_id, changed_at DESC);

-- 4. Per-deal document list (GET /api/deals/:id/documents).
CREATE INDEX idx_documents_deal_id ON documents (deal_id);

-- 5. DocuSign webhook updateMany({ where: { docusign_envelope_id } }) was a
--    full-table scan. Partial: most documents never enter an envelope.
CREATE INDEX idx_documents_docusign_envelope_id
  ON documents (docusign_envelope_id)
  WHERE docusign_envelope_id IS NOT NULL;

-- 6. Per-deal offers and tracked properties lists.
CREATE INDEX idx_offers_deal_id ON offers (deal_id);
CREATE INDEX idx_tracked_properties_deal_id ON tracked_properties (deal_id);

-- 7. The public iCal feed (GET /api/calendar/:token/feed.ics) is polled
--    ~every 15 min per connected user and seq-scanned users. Tokens are
--    random UUIDs, so also enforce uniqueness; partial to skip the many NULLs.
CREATE UNIQUE INDEX idx_users_calendar_token
  ON users (calendar_token)
  WHERE calendar_token IS NOT NULL;
