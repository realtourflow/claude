/**
 * The core-key registry the AI maps detected fields to — built DIRECTLY from the
 * existing contract registry (FACT_FIELDS + AUTO_VALUE_KEYS in lib/contract-facts).
 * This is the single source of truth; we do NOT invent a parallel set. The only
 * thing added here is a human-readable description per key for the AI prompt.
 *
 * core-keys.test.ts asserts every registry key has a description, so adding a new
 * fact without describing it fails CI rather than silently degrading mapping.
 */
import { FACT_FIELDS, AUTO_VALUE_KEYS } from "../contract-facts";
import type { CoreKeyDescriptor } from "./types";

// One sentence per key, written for the model. Keys mirror contract-facts exactly.
const DESCRIPTIONS: Record<string, string> = {
  // AUTO_VALUE_KEYS — party/agent identity, auto-sourced from the deal.
  buyer_name: "Full name(s) of the buyer(s) on the deal.",
  agent_name: "Full name of the real estate agent on the deal.",
  brokerage_name: "Name of the agent's brokerage / firm.",
  consumer_name: "Printed name of the first consumer (buyer or seller) on a statewide consumer notice — e.g. the wire-fraud notice.",
  consumer_name_2: "Printed name of the second consumer on a statewide consumer notice (optional).",
  // FACT_FIELDS — core contract facts entered once per deal.
  legal_description: "Legal description of the property (lot / block / subdivision).",
  parcel_or_ppin: "Parcel ID or PPIN (the property tax identifier).",
  city: "Property city.",
  state: "Property state.",
  zip: "Property ZIP / postal code.",
  purchase_price: "Purchase price / offer amount, in dollars.",
  earnest_money_amount: "Earnest money deposit amount, in dollars.",
  earnest_money_holder: "Who holds the earnest money (escrow agent / firm).",
  financing_type: "Financing type (cash, conventional, FHA, VA, etc.).",
  loan_amount_or_pct: "Loan amount or loan-to-value percentage.",
  offer_date: "Date the offer was made.",
  acceptance_binding_date: "Date the contract became binding (acceptance date).",
  closing_date: "Closing / settlement date.",
  possession: "Possession terms or the date the buyer takes possession.",
  buyer_broker_comp: "Buyer-broker compensation (an amount or a percentage).",
  agency_role: "Agency relationship / role (buyer's agent, dual agency, etc.).",
  included_fixtures: "Fixtures / personal property included in the sale.",
  additional_provisions: "Additional contract provisions or special terms.",
};

export const CORE_KEYS: CoreKeyDescriptor[] = [
  ...AUTO_VALUE_KEYS.map((key) => ({
    key: key as string,
    kind: "identity",
    description: DESCRIPTIONS[key] ?? key,
  })),
  ...(Object.keys(FACT_FIELDS) as (keyof typeof FACT_FIELDS)[]).map((key) => ({
    key: key as string,
    kind: FACT_FIELDS[key] as string,
    description: DESCRIPTIONS[key] ?? key,
  })),
];

const CORE_KEY_SET = new Set(CORE_KEYS.map((c) => c.key));

/** Whether a key is one of the canonical contract keys (mapper output guard). */
export function isCoreKey(key: string): boolean {
  return CORE_KEY_SET.has(key);
}

export type { CoreKeyDescriptor };
