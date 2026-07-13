-- #184: persist the agent-set "Buyer's Progress" status so the seller portal
-- can read it (was previously an in-browser zustand map that never left the
-- agent's session). Free-text column; the API validates values against the
-- canonical step list in web/lib/buyer-status.ts. NULL = not set.
ALTER TABLE deals ADD COLUMN buyer_status TEXT;
