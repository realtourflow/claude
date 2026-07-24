-- #378: model a "bridge" pairing between one client's BUY-side deal and their
-- SELL-side deal (buy-before-you-sell). The two transactions share a timeline
-- and carry a payoff dependency — the sell must close to retire the bridge
-- loan. This table is the durable link the eligibility/coordination/ARIVE-handoff
-- work (#379–#382) attaches to; it holds NO loan terms itself.
--
-- One buy deal ↔ one sell deal, oriented by column (buy_deal_id / sell_deal_id).
-- The orientation is derived server-side from each deal's `type` (buy | sell),
-- never trusted from the client. A deal participates in at most one bridge on
-- each side (the two UNIQUE constraints), can't be linked to itself
-- (deal_links_distinct_check), and the row dies with either deal or the owning
-- agent (ON DELETE CASCADE). Same-client is NOT enforced here (deals carry no
-- client FK — clients are participants); the owning agent asserts the pairing
-- by owning both deals, checked in the API layer.
CREATE TABLE deal_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buy_deal_id  uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  sell_deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  agent_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deal_links_distinct_check CHECK (buy_deal_id <> sell_deal_id),
  CONSTRAINT deal_links_buy_unique UNIQUE (buy_deal_id),
  CONSTRAINT deal_links_sell_unique UNIQUE (sell_deal_id)
);

-- Agent-scoped listing ("my bridges") and reverse (sell-side) lookups. The two
-- UNIQUE constraints already index buy_deal_id / sell_deal_id for buy-side and
-- membership lookups.
CREATE INDEX idx_deal_links_agent ON deal_links(agent_id);
CREATE INDEX idx_deal_links_sell ON deal_links(sell_deal_id);
