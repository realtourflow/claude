/**
 * Real-estate markets an agent can serve, grouped for the picker. Agents select
 * one or MORE (users.markets JSONB array); users.market keeps the FIRST pick as
 * the primary market — it drives board-keyed contract forms
 * (lib/docusign-templates.ts `board` + listTemplatesForMarket), uploaded_forms
 * board scoping, and known-forms recognition. Form promotions are scoped to a
 * company + market combo (form_promotions), matched against the FULL markets
 * array.
 *
 * Single source of truth for the onboarding picker, profile validation, admin
 * display, and the promotion market dropdown. BIRMINGHAM_AAR and
 * BALDWIN_GULF_COAST keep their legacy codes — they are stored in prod rows.
 */
export const MARKETS = [
  // Greater Alabama MLS
  { code: "BIRMINGHAM_AAR", label: "Birmingham Metro", group: "Greater Alabama MLS" },
  { code: "OVER_THE_MOUNTAIN", label: "Over-the-Mountain", group: "Greater Alabama MLS" },
  { code: "SHELBY_COUNTY", label: "Shelby County Suburbs", group: "Greater Alabama MLS" },
  { code: "TRUSSVILLE_NORTH_JEFFERSON", label: "Trussville & North Jefferson", group: "Greater Alabama MLS" },
  // Valley MLS
  { code: "HUNTSVILLE", label: "Huntsville", group: "Valley MLS" },
  { code: "MUSCLE_SHOALS", label: "Muscle Shoals", group: "Valley MLS" },
  { code: "DECATUR", label: "Decatur", group: "Valley MLS" },
  { code: "ATHENS", label: "Athens", group: "Valley MLS" },
  { code: "LOOKOUT_MOUNTAIN", label: "Lookout Mountain", group: "Valley MLS" },
  // Coastal & Southern
  { code: "BALDWIN_GULF_COAST", label: "Baldwin County / Gulf Coast", group: "Coastal & Southern" },
  { code: "EASTERN_SHORE", label: "Eastern Shore", group: "Coastal & Southern" },
  { code: "MOBILE_METRO", label: "Mobile Metro", group: "Coastal & Southern" },
  // College Town Markets
  { code: "LEE_COUNTY", label: "Lee County (Auburn/Opelika)", group: "College Town Markets" },
  { code: "TUSCALOOSA", label: "Tuscaloosa", group: "College Town Markets" },
  // River Region & Wiregrass
  { code: "MONTGOMERY", label: "Montgomery", group: "River Region & Wiregrass" },
  { code: "DOTHAN_WIREGRASS", label: "Dothan/Wiregrass", group: "River Region & Wiregrass" },
  { code: "PHENIX_CITY", label: "Phenix City", group: "River Region & Wiregrass" },
  // Lake Markets
  { code: "LAKE_MARTIN", label: "Lake Martin", group: "Lake Markets" },
  { code: "LEWIS_SMITH_LAKE", label: "Lewis Smith Lake", group: "Lake Markets" },
  { code: "LAKE_GUNTERSVILLE", label: "Lake Guntersville", group: "Lake Markets" },
  { code: "WEISS_LAKE", label: "Weiss Lake", group: "Lake Markets" },
] as const;

export type MarketCode = (typeof MARKETS)[number]["code"];

/** Group titles in display order, for grouped pickers. */
export const MARKET_GROUPS = [
  "Greater Alabama MLS",
  "Valley MLS",
  "Coastal & Southern",
  "College Town Markets",
  "River Region & Wiregrass",
  "Lake Markets",
] as const;

export function isValidMarket(value: string): value is MarketCode {
  return MARKETS.some((m) => m.code === value);
}

/** Human label for a market code; "" / unknown → "Not set". */
export function marketLabel(code: string): string {
  return MARKETS.find((m) => m.code === code)?.label ?? "Not set";
}
