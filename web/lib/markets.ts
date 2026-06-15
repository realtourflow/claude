/**
 * Real-estate markets (boards/associations). An agent belongs to exactly one;
 * it drives which board-keyed contract forms they see (see
 * lib/docusign-templates.ts `board` + listTemplatesForMarket). The codes are
 * the canonical values stored in users.market / deals.market and referenced by
 * DOCUSIGN_TEMPLATES entries — the labels are what agents see in the UI.
 *
 * Single source of truth for the onboarding picker, profile validation, and
 * admin display. Adding a market = one entry here + template registry entries
 * (v2 backlog: ValleyMLS Huntsville, etc.).
 */
export const MARKETS = [
  { code: "BIRMINGHAM_AAR", label: "Birmingham" },
  { code: "BALDWIN_GULF_COAST", label: "Alabama Gulf Coast" },
] as const;

export type MarketCode = (typeof MARKETS)[number]["code"];

export function isValidMarket(value: string): value is MarketCode {
  return MARKETS.some((m) => m.code === value);
}

/** Human label for a market code; "" / unknown → "Not set". */
export function marketLabel(code: string): string {
  return MARKETS.find((m) => m.code === code)?.label ?? "Not set";
}
