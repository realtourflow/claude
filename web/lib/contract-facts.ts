/**
 * Contract-fill data layer: core facts (one row per deal, shared by every
 * form) + per-form terms (JSON validated against the form's fieldMap).
 *
 * The merged value set (facts ∪ terms, with deal-level fallbacks like
 * purchase_price ← deals.price) feeds buildPrefillTabs at send time and the
 * prep screen before it.
 */
import { prisma } from "./db";
import type { FieldMapEntry } from "./docusign-templates";

export class ContractDataError extends Error {}

// fieldMap keys that are auto-sourced from the deal at send time (party/agent
// identity), not core facts and not agent-entered terms. They are filled
// automatically by getMergedContractValues, hidden from the prep board fields,
// and rejected as terms.
export const AUTO_VALUE_KEYS = [
  "buyer_name",
  "agent_name",
  "brokerage_name",
] as const;
const AUTO_KEY_SET = new Set<string>(AUTO_VALUE_KEYS);

// Canonical core facts — column name → kind. Drives PUT validation, value
// coercion, and the prep screen's core group. Parties/agent/brokerage live on
// users/deal_participants, never here.
export const FACT_FIELDS = {
  legal_description: "text",
  parcel_or_ppin: "text",
  city: "text",
  state: "text",
  zip: "text",
  purchase_price: "number",
  earnest_money_amount: "number",
  earnest_money_holder: "text",
  financing_type: "text",
  loan_amount_or_pct: "text",
  offer_date: "date",
  acceptance_binding_date: "date",
  closing_date: "date",
  possession: "text",
  buyer_broker_comp: "text",
  agency_role: "text",
  included_fixtures: "json",
  additional_provisions: "text",
} as const;

export type FactKey = keyof typeof FACT_FIELDS;
export type FactKind = (typeof FACT_FIELDS)[FactKey];

// Auto-fill bridge: a form-specific Data Label → the canonical deal value that
// should pre-fill it. The source is a key already present in the merged value
// set — a FACT_FIELDS column, an auto-sourced identity (agent_name), the deal's
// street address, or seller_name. This lets each form keep its own label (e.g.
// `property_city`) yet still inherit the deal's `city`, WITHOUT renaming the
// template tag. The agent always wins: a saved term overrides the alias. A
// source with no value just leaves the field blank for the agent to fill in.
export const CONTRACT_FIELD_ALIASES: Record<string, string> = {
  property_address: "address", // deals.address
  property_city: "city",
  property_state: "state",
  property_zip: "zip",
  ppin: "parcel_or_ppin",
  loan_amount: "loan_amount_or_pct",
  effective_date: "acceptance_binding_date",
  possession_date: "possession",
  buyer_broker_comp_percentage: "buyer_broker_comp",
  buyer_agent: "agent_name", // the buyer's agent IS the deal agent
};

function coerce(key: string, kind: FactKind, value: unknown): unknown {
  if (value === null || value === undefined || value === "") return null;
  switch (kind) {
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (Number.isNaN(n)) {
        throw new ContractDataError(`${key} must be a number`);
      }
      return n;
    }
    case "date": {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) {
        throw new ContractDataError(`${key} must be a date (YYYY-MM-DD)`);
      }
      return d;
    }
    case "json": {
      if (typeof value !== "object") {
        throw new ContractDataError(`${key} must be an object`);
      }
      return value;
    }
    default: {
      if (typeof value !== "string" && typeof value !== "number") {
        throw new ContractDataError(`${key} must be text`);
      }
      return String(value);
    }
  }
}

/** Validates + coerces a partial facts patch. Unknown keys are rejected. */
export function coerceFactsPatch(
  patch: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const kind = FACT_FIELDS[key as FactKey];
    if (!kind) {
      throw new ContractDataError(`unknown contract fact "${key}"`);
    }
    const coerced = coerce(key, kind, value);
    // Text columns are NOT NULL DEFAULT '' — store empty string, not null.
    out[key] =
      coerced === null && (kind === "text" || kind === "json")
        ? kind === "json"
          ? {}
          : ""
        : coerced;
  }
  return out;
}

export async function upsertFacts(
  dealId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const data = coerceFactsPatch(patch);
  await prisma.deal_contract_facts.upsert({
    where: { deal_id: dealId },
    create: { deal_id: dealId, ...data },
    update: { ...data, updated_at: new Date() },
  });
}

/**
 * Per-form terms must match the form's fieldMap: every key exists in the map,
 * is NOT a core fact (those belong in deal_contract_facts), and the value type
 * matches the tab type (checkbox → boolean, text → string|number).
 */
export function validateTerms(
  fieldMap: Record<string, FieldMapEntry>,
  terms: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(terms)) {
    const entry = fieldMap[key];
    if (!entry) {
      throw new ContractDataError(
        `"${key}" is not a field on this form — check the form's fieldMap`
      );
    }
    if (key in FACT_FIELDS) {
      throw new ContractDataError(
        `"${key}" is a core contract fact — save it via contract-facts, not terms`
      );
    }
    if (AUTO_KEY_SET.has(key)) {
      throw new ContractDataError(
        `"${key}" is auto-filled from the deal — it can't be set as a term`
      );
    }
    if (entry.type === "checkbox") {
      if (typeof value !== "boolean") {
        throw new ContractDataError(`"${key}" must be true/false (checkbox)`);
      }
    } else if (typeof value !== "string" && typeof value !== "number") {
      throw new ContractDataError(`"${key}" must be text or a number`);
    }
  }
}

export async function upsertTerms(
  dealId: string,
  formKey: string,
  fieldMap: Record<string, FieldMapEntry>,
  terms: Record<string, unknown>
): Promise<void> {
  validateTerms(fieldMap, terms);
  await prisma.deal_contract_terms.upsert({
    where: { deal_id_form_key: { deal_id: dealId, form_key: formKey } },
    create: { deal_id: dealId, form_key: formKey, terms: terms as object },
    update: { terms: terms as object, updated_at: new Date() },
  });
}

/**
 * The merged value set for a deal+form: core facts (with purchase_price
 * falling back to deals.price) plus the form's saved terms. Keys with no
 * value are simply absent — prefill leaves those template fields blank.
 */
export async function getMergedContractValues(
  dealId: string,
  formKey: string
): Promise<Record<string, unknown>> {
  const [facts, deal, termsRow, buyers, sellers] = await Promise.all([
    prisma.deal_contract_facts.findUnique({ where: { deal_id: dealId } }),
    prisma.deals.findUnique({
      where: { id: dealId },
      select: {
        price: true,
        address: true,
        users: { select: { name: true, brokerage: true } },
      },
    }),
    prisma.deal_contract_terms.findFirst({
      where: { deal_id: dealId, form_key: formKey },
      select: { terms: true },
    }),
    prisma.deal_participants.findMany({
      where: { deal_id: dealId, role: "buyer" },
      select: { users: { select: { name: true } } },
      orderBy: { user_id: "asc" },
    }),
    prisma.deal_participants.findMany({
      where: { deal_id: dealId, role: "seller" },
      select: { users: { select: { name: true } } },
      orderBy: { user_id: "asc" },
    }),
  ]);

  const values: Record<string, unknown> = {};

  // Auto-sourced party/agent identity (see AUTO_VALUE_KEYS). Only set when
  // present so a missing value leaves the template tab blank for the signer.
  const buyerNames = buyers
    .map((b) => b.users?.name?.trim())
    .filter((n): n is string => !!n);
  if (buyerNames.length > 0) values.buyer_name = buyerNames.join(" & ");
  if (deal?.users?.name) values.agent_name = deal.users.name;
  if (deal?.users?.brokerage) values.brokerage_name = deal.users.brokerage;
  if (facts) {
    for (const key of Object.keys(FACT_FIELDS) as FactKey[]) {
      const v = (facts as Record<string, unknown>)[key];
      if (v === null || v === undefined || v === "") continue;
      // Decimal columns stringify cleanly; Dates pass through for the
      // prefill formatter.
      values[key] =
        FACT_FIELDS[key] === "number" && typeof v === "object" ? String(v) : v;
    }
  }
  if (values.purchase_price === undefined && deal?.price != null) {
    values.purchase_price = String(deal.price);
  }

  // Seller names (soft auto-source — blank when the deal has no seller
  // participant; agent can still type it as a term, unlike buyer_name).
  const sellerNames = sellers
    .map((s) => s.users?.name?.trim())
    .filter((n): n is string => !!n);
  if (sellerNames.length > 0) values.seller_name = sellerNames.join(" & ");
  if (deal?.address) values.address = deal.address;

  // Auto-fill aliases: a form's own label inherits the canonical deal value.
  // The agent's saved term (applied below) still wins.
  for (const [alias, source] of Object.entries(CONTRACT_FIELD_ALIASES)) {
    if (values[alias] !== undefined) continue;
    const v = values[source];
    if (v !== undefined && v !== null && v !== "") values[alias] = v;
  }

  const terms = (termsRow?.terms ?? {}) as Record<string, unknown>;
  for (const [key, v] of Object.entries(terms)) {
    if (v === null || v === undefined || v === "") continue;
    values[key] = v;
  }
  return values;
}
