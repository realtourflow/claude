-- Text-layout recognition fingerprint: a MinHash signature of the form's
-- extracted text. Lets a NON-exact, same-layout copy (re-saved / re-exported,
-- different bytes — so the content hash misses) still match a known form by
-- TEXT similarity (Jaccard) and get exact catalog placement, no vision.
-- Null = not computed (e.g. older / fillable entries that match by structure).
ALTER TABLE known_forms ADD COLUMN text_minhash JSONB;
