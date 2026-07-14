-- #90 (FF10): drop the hot-path indexes.
-- NOTE: the duplicate non-custom checklist rows deleted by the up migration
-- are NOT restorable.
DROP INDEX IF EXISTS idx_users_calendar_token;
DROP INDEX IF EXISTS idx_tracked_properties_deal_id;
DROP INDEX IF EXISTS idx_offers_deal_id;
DROP INDEX IF EXISTS idx_documents_docusign_envelope_id;
DROP INDEX IF EXISTS idx_documents_deal_id;
DROP INDEX IF EXISTS idx_deal_stage_history_deal_changed;
DROP INDEX IF EXISTS idx_checklist_items_deal_label_default;
