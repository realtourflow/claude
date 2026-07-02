-- Retire System 1 (agent_doc_templates). Migrate every legacy template into the
-- Vision pipeline as a 'pending_split' bundle so the admin reviews it (assigns a
-- type + places fields via the split flow), then drop the legacy table.
-- One-way: the down migration recreates the empty table but cannot restore rows.
INSERT INTO uploaded_forms
  (agent_id, label, side, board, source_s3_key, source_file_name, mime_type,
   file_size, detection_source, status, attested_by, attestation_statement)
SELECT
  t.agent_id, t.name, 'both', COALESCE(u.market, ''), t.s3_key, t.file_name,
  t.mime_type, t.file_size, 'bundle', 'pending_split', t.agent_id,
  'Migrated from a legacy document template.'
FROM agent_doc_templates t
JOIN users u ON u.id = t.agent_id;

DROP TABLE agent_doc_templates;
