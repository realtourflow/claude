/**
 * Net sheet default deduction lines — TypeScript port of the retired Go
 * backend's `buildDefaultLines` (backend/internal/handlers/net_sheets.go,
 * commit 74541ad). New net sheets are seeded with these on auto-create so a
 * seller deal never starts as a blank, unusable document (#181).
 *
 * Figures (unchanged from the Go handler):
 *  - Commissions default to 3% of the sale price per side.
 *  - Transfer taxes default to 0.1% of the sale price.
 *  - Title/closing fee and property-tax proration seed at $0 (agent fills in;
 *    proration recalcs client-side from annual taxes + closing date).
 *  - Optional lines (mortgage payoff, concessions, …) seed at $0, disabled.
 *
 * Commission pct resolution, most specific wins:
 *  1. The deal's own `commission_pct` (the "Est. Commission" field) for the
 *     agent's OWN side — but only when it's off the 3.0 default, since the
 *     column always carries a value and we can't tell "default" from
 *     "deliberately 3.0" otherwise.
 *  2. The agent's onboarding settings (`user_settings.settings`), in either
 *     the current camelCase shape (`buyerCommission: {isPct, pct, amount}`)
 *     or the legacy Go-era snake_case shape (`buyer_commission: {is_pct, …}`).
 *  3. 3% fallback.
 */

export type NetSheetLine = {
  id: string;
  label: string;
  category: "commission" | "title" | "taxes" | "proration" | "payoff" | "optional" | "custom";
  amount: number;
  pct?: number | null;
  is_pct: boolean;
  required: boolean;
  enabled: boolean;
  editable: boolean;
  auto_populated: boolean;
};

export type CommissionSetting = {
  is_pct: boolean;
  pct: number | null;
  amount: number | null;
};

export type NetSheetCommissionSettings = {
  buyer: CommissionSetting | null;
  seller: CommissionSetting | null;
};

const DEFAULT_COMMISSION_PCT = 3.0;
const TRANSFER_TAX_PCT = 0.1; // percent — 0.1% of the sale price

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseCommissionSetting(raw: unknown): CommissionSetting | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const isPct = typeof o.is_pct === "boolean" ? o.is_pct : typeof o.isPct === "boolean" ? o.isPct : null;
  if (isPct === null) return null;
  return { is_pct: isPct, pct: num(o.pct), amount: num(o.amount) };
}

/**
 * Extracts buyer/seller commission config from the agent's `user_settings`
 * JSON blob. Accepts both the current onboarding shape (camelCase) and the
 * legacy Go-era shape (snake_case) — prod rows may carry either.
 */
export function parseAgentCommissionSettings(settings: unknown): NetSheetCommissionSettings {
  if (!settings || typeof settings !== "object") return { buyer: null, seller: null };
  const o = settings as Record<string, unknown>;
  return {
    buyer: parseCommissionSetting(o.buyerCommission) ?? parseCommissionSetting(o.buyer_commission),
    seller: parseCommissionSetting(o.sellerCommission) ?? parseCommissionSetting(o.seller_commission),
  };
}

function commissionLine(
  id: string,
  label: string,
  salePrice: number,
  comm: CommissionSetting | null
): NetSheetLine {
  const base = {
    id,
    label,
    category: "commission" as const,
    required: true,
    enabled: true,
    editable: true,
    auto_populated: comm !== null,
  };
  if (comm) {
    if (comm.is_pct && comm.pct !== null) {
      return {
        ...base,
        is_pct: true,
        pct: comm.pct,
        amount: Math.round(salePrice * (comm.pct / 100)),
      };
    }
    if (!comm.is_pct && comm.amount !== null) {
      return { ...base, is_pct: false, pct: null, amount: comm.amount };
    }
    // Malformed setting — fall through to the default.
  }
  return {
    ...base,
    auto_populated: false,
    is_pct: true,
    pct: DEFAULT_COMMISSION_PCT,
    amount: Math.round(salePrice * (DEFAULT_COMMISSION_PCT / 100)),
  };
}

function requiredLine(
  id: string,
  label: string,
  category: NetSheetLine["category"],
  amount: number
): NetSheetLine {
  return {
    id,
    label,
    category,
    amount,
    pct: null,
    is_pct: false,
    required: true,
    enabled: true,
    editable: true,
    auto_populated: false,
  };
}

function optionalLine(id: string, label: string, category: NetSheetLine["category"]): NetSheetLine {
  return {
    id,
    label,
    category,
    amount: 0,
    pct: null,
    is_pct: false,
    required: false,
    enabled: false,
    editable: true,
    auto_populated: false,
  };
}

export type BuildDefaultLinesOptions = {
  dealType: string; // "sell" | "buy"
  salePrice: number;
  settings?: NetSheetCommissionSettings | null;
  /** The deal's own commission_pct — overrides the agent's own-side line when off the 3.0 default. */
  dealCommissionPct?: number | null;
};

export function buildDefaultLines(opts: BuildDefaultLinesOptions): NetSheetLine[] {
  const { dealType, salePrice } = opts;
  const settings = opts.settings ?? { buyer: null, seller: null };

  // A deal-level pct that differs from the column default was set on purpose;
  // treat it as the agent's own-side commission.
  const dealPct = opts.dealCommissionPct ?? null;
  const ownSideOverride: CommissionSetting | null =
    dealPct !== null && dealPct !== DEFAULT_COMMISSION_PCT
      ? { is_pct: true, pct: dealPct, amount: null }
      : null;

  const transferTaxes: NetSheetLine = {
    id: "transfer_taxes",
    label: "Transfer Taxes",
    category: "taxes",
    amount: Math.round(salePrice * (TRANSFER_TAX_PCT / 100)),
    pct: TRANSFER_TAX_PCT,
    is_pct: true,
    required: true,
    enabled: true,
    editable: true,
    auto_populated: true,
  };

  const proration = requiredLine("property_tax_proration", "Property Tax Proration", "proration", 0);

  if (dealType === "sell") {
    return [
      commissionLine(
        "listing_commission",
        "Listing Agent Commission",
        salePrice,
        ownSideOverride ?? settings.seller
      ),
      commissionLine("buyers_agent_commission", "Buyer's Agent Commission", salePrice, settings.buyer),
      requiredLine("title_closing_fee", "Title & Closing Fee", "title", 0),
      transferTaxes,
      proration,
      optionalLine("mortgage_payoff", "Mortgage Payoff", "payoff"),
      optionalLine("seller_concessions", "Seller Concessions", "optional"),
      optionalLine("repair_credits", "Repair Credits", "optional"),
      optionalLine("termite", "Termite Inspection", "optional"),
      optionalLine("septic", "Septic Clean Out", "optional"),
      optionalLine("home_warranty", "Home Warranty", "optional"),
      optionalLine("hoa_payoff", "HOA Payoff", "optional"),
      optionalLine("survey", "Survey", "optional"),
    ];
  }

  // buy deal — closing cost estimate
  return [
    commissionLine(
      "buyers_agent_commission",
      "Buyer's Agent Commission",
      salePrice,
      ownSideOverride ?? settings.buyer
    ),
    requiredLine("title_closing_fee", "Title & Closing Fee", "title", 0),
    transferTaxes,
    proration,
    optionalLine("appraisal", "Appraisal", "optional"),
    optionalLine("termite", "Termite Inspection", "optional"),
    optionalLine("septic", "Septic Clean Out", "optional"),
    optionalLine("hoa_dues", "HOA Dues (First Month)", "optional"),
  ];
}
