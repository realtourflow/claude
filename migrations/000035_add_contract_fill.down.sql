DROP TABLE IF EXISTS deal_contract_terms;
DROP TABLE IF EXISTS deal_contract_facts;
ALTER TABLE deals DROP COLUMN IF EXISTS market;
ALTER TABLE users DROP COLUMN IF EXISTS market;
