-- #253: persist the agent-entered "Est. Closing Date" from the New Deal modal.
-- Before this, the field was silently dropped and every non-ARIVE deal (all
-- seller deals + outside-lender buyers) had no closing date anywhere — no
-- pipeline "Closes …" chip, no timeline anchor, empty calendar. The ARIVE
-- key-date closing (deals.arive_key_dates) still takes precedence when present;
-- this manual date is the fallback for non-ARIVE deals. NULL = not set.
-- Distinct from net_sheets.closing_date and deal_contract_facts.closing_date,
-- which are separate per-feature dates.
ALTER TABLE deals ADD COLUMN closing_date date;
