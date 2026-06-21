-- Phase 2 of the vision pipeline: the agent PICKS the document type on upload
-- ("this is my purchase agreement"). That choice selects the TYPE's position-free
-- field set, which guided vision later locates on the agent's specific layout
-- (Phase 3). Record the picked type on the upload. SET NULL so deleting a type
-- just unlinks the uploads (matches known_forms.type_id).
ALTER TABLE uploaded_forms
  ADD COLUMN form_type_id UUID REFERENCES form_types(id) ON DELETE SET NULL;
CREATE INDEX idx_uploaded_forms_form_type_id ON uploaded_forms(form_type_id);
