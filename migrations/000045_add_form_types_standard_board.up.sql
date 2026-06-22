-- Phase 4 (remember reviewed forms): scope flag for the type catalog. A remembered
-- form's reuse is scoped to the uploading agent's MARKET by default (a reviewed
-- RE/MAX purchase agreement is offered only within that market — and the fingerprint
-- match means only that exact form is ever reused, never another brokerage's). A
-- type marked standard_board_form is a genuinely standard/board-wide document (e.g.
-- a federal disclosure), so its remembered forms are saved universal (board = '').
ALTER TABLE form_types
  ADD COLUMN standard_board_form BOOLEAN NOT NULL DEFAULT false;
