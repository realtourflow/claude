/**
 * Fallback company list for pickers when the managed GET /api/brokerages fetch
 * hasn't resolved (or fails). Mirrors the migration 000049 seed — the DB list is
 * the source of truth; admin-approved "Other" suggestions join it over time.
 */
export const BROKERAGE_FALLBACK = [
  "ARC Realty",
  "Keller Williams",
  "RE/MAX",
  "Coldwell Banker",
  "eXp Realty",
  "Compass",
  "Century 21",
  "Berkshire Hathaway HomeServices",
  "Independent",
];
