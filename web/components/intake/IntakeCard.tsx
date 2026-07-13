"use client";

/**
 * IntakeCard (#175) — read-only card showing the buyer/seller onboarding
 * questionnaire persisted on the deal (`deals.intake`, migration 000050).
 *
 * Self-contained: give it a dealId and it fetches GET /api/deals/:id/intake
 * itself (the endpoint is agent-/participant-scoped server-side). Or pass the
 * `intake` payload directly to skip the fetch (pass null for the empty state).
 *
 * NOT mounted anywhere yet — DealDetail.tsx is owned by another PR. To mount
 * it there (follow-up DealDetail-owner PR), add:
 *
 *   import IntakeCard from "@/components/intake/IntakeCard";
 *   <IntakeCard dealId={deal.id} />
 *
 * (e.g. on the deal's overview/intake tab, same pattern as
 * AddCustomLineControl in PR #236 → #240.)
 */
import { useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import { api } from "@/lib/api-client";

export type DealIntakePayload = {
  role: "buyer" | "seller";
  submitted_at: string;
  answers: Record<string, unknown>;
};

type Props = {
  dealId: string;
  /** Pass the payload to skip the fetch; pass null to force the empty state. */
  intake?: DealIntakePayload | null;
};

// Keys rendered by the special rows below — excluded from the generic list.
const SPECIAL_KEYS = new Set(["minBudget", "maxBudget", "lenderChoice"]);

// Number answers formatted as dollars.
const MONEY_KEYS = new Set(["minBudget", "maxBudget", "mortgageBalance", "propertyTax", "hoaDues"]);

const LENDER_LABELS: Record<string, string> = {
  mountain: "Mountain Mortgage",
  fastpass: "Fast Pass (Mountain Mortgage)",
  other: "Using another lender",
};

// Curated display order + labels per role. Unknown keys still render (with a
// humanized label) so future questionnaire fields never silently disappear.
const BUYER_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "areas", label: "Areas" },
  { key: "bedrooms", label: "Bedrooms" },
  { key: "bathrooms", label: "Bathrooms" },
  { key: "propertyType", label: "Property type" },
  { key: "cashOrLoan", label: "Cash or loan" },
  { key: "firstTimeBuyer", label: "First-time buyer" },
  { key: "journeyStage", label: "Journey stage" },
  { key: "creditScore", label: "Credit score" },
  { key: "monthlyIncome", label: "Monthly income" },
  { key: "employment", label: "Employment" },
  { key: "military", label: "Military service" },
  { key: "garage", label: "Garage" },
  { key: "pool", label: "Pool" },
  { key: "basement", label: "Basement" },
  { key: "schools", label: "School preference" },
  { key: "trackingAddress", label: "First property to track" },
  { key: "notes", label: "Notes" },
  { key: "contactName", label: "Contact name" },
  { key: "contactPhone", label: "Contact phone" },
  { key: "contactEmail", label: "Contact email" },
];

const SELLER_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "address", label: "Property address" },
  { key: "desiredListDate", label: "Target list date" },
  { key: "whatMattersMost", label: "Top priority" },
  { key: "priceExpectation", label: "Price expectation" },
  { key: "hardDeadline", label: "Hard deadline" },
  { key: "timelineFlexibility", label: "Timeline flexibility" },
  { key: "reasonsForSelling", label: "Reasons for selling" },
  { key: "stressfulOrUrgent", label: "Stressful or urgent" },
  { key: "stressNotes", label: "What's going on" },
  { key: "hasMortgage", label: "Has a mortgage" },
  { key: "mortgageBalance", label: "Mortgage balance" },
  { key: "mortgageRate", label: "Interest rate" },
  { key: "mortgageAssumable", label: "Assumable" },
  { key: "hasHeloc", label: "HELOC / 2nd mortgage" },
  { key: "propertyTax", label: "Annual property tax" },
  { key: "propertyType", label: "Property type" },
  { key: "occupancy", label: "Occupancy" },
  { key: "yearBuilt", label: "Year built" },
  { key: "conditionRating", label: "Condition" },
  { key: "knownIssues", label: "Known issues" },
  { key: "majorUpgrades", label: "Major upgrades" },
  { key: "upgradesList", label: "Upgrades" },
  { key: "hasHoa", label: "HOA" },
  { key: "hoaDues", label: "HOA dues (monthly)" },
  { key: "preListingPrep", label: "Open to pre-listing prep" },
  { key: "preListingSpend", label: "Pre-listing budget" },
  { key: "biggerFear", label: "Bigger fear" },
  { key: "openToIncentives", label: "Open to incentives" },
  { key: "alsoLookingToBuy", label: "Also looking to buy" },
  { key: "buyTiming", label: "Buy timing" },
  { key: "needSaleProceeds", label: "Needs sale proceeds to buy" },
  { key: "contactName", label: "Contact name" },
  { key: "contactPhone", label: "Contact phone" },
  { key: "contactEmail", label: "Contact email" },
];

function moneyShort(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  return `$${Math.round(n / 1000)}K`;
}

/** camelCase → "Camel case" fallback label for unlisted keys. */
function humanize(key: string): string {
  const spaced = key.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Formats an answer value for display; null = skip the row entirely. */
function formatValue(key: string, v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return null;
    if (t === "yes") return "Yes";
    if (t === "no") return "No";
    return t;
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    return MONEY_KEYS.has(key) ? moneyShort(v) : String(v);
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) {
    const items = v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
    return items.length > 0 ? items.join(", ") : null;
  }
  return null;
}

type Row = { key: string; label: string; value: string };

function buildRows(intake: DealIntakePayload): Row[] {
  const fields = intake.role === "seller" ? SELLER_FIELDS : BUYER_FIELDS;
  const rows: Row[] = [];

  // Budget first — the combined min/max range.
  const min = intake.answers.minBudget;
  const max = intake.answers.maxBudget;
  if (typeof min === "number" && typeof max === "number" && Number.isFinite(min) && Number.isFinite(max)) {
    rows.push({ key: "budget", label: "Budget", value: `${moneyShort(min)} – ${moneyShort(max)}` });
  }

  const listed = new Set<string>(SPECIAL_KEYS);
  for (const { key, label } of fields) {
    listed.add(key);
    const value = formatValue(key, intake.answers[key]);
    if (value !== null) rows.push({ key, label, value });
  }
  // Future-proofing: any answer key we don't know about still renders.
  for (const key of Object.keys(intake.answers)) {
    if (listed.has(key)) continue;
    const value = formatValue(key, intake.answers[key]);
    if (value !== null) rows.push({ key, label: humanize(key), value });
  }
  return rows;
}

export default function IntakeCard({ dealId, intake: intakeProp }: Props) {
  // undefined = still loading (fetch path only); null = no intake.
  const [fetched, setFetched] = useState<DealIntakePayload | null | undefined>(undefined);

  useEffect(() => {
    if (intakeProp !== undefined) return; // payload supplied — no fetch
    let cancelled = false;
    api
      .get<{ intake: DealIntakePayload | null }>(`/deals/${dealId}/intake`)
      .then((res) => {
        if (!cancelled) setFetched(res.intake ?? null);
      })
      .catch(() => {
        // Read failures degrade to the empty state — this card is contextual,
        // never blocking.
        if (!cancelled) setFetched(null);
      });
    return () => {
      cancelled = true;
    };
  }, [dealId, intakeProp]);

  const intake = intakeProp !== undefined ? intakeProp : fetched;

  const header = (
    <div className="mb-3 flex items-center gap-2">
      <ClipboardList size={16} className="text-brand-navy" />
      <h3 className="text-sm font-bold uppercase tracking-wider text-brand-navy">Client Intake</h3>
    </div>
  );

  if (intake === undefined) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        {header}
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  if (intake === null) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        {header}
        <p className="text-sm text-gray-400">
          No intake submitted yet — it appears here when the client finishes onboarding.
        </p>
      </div>
    );
  }

  const rows = buildRows(intake);
  const lenderChoice =
    typeof intake.answers.lenderChoice === "string" && intake.answers.lenderChoice.trim()
      ? intake.answers.lenderChoice.trim()
      : null;
  const submitted = new Date(intake.submitted_at);
  const submittedLabel = Number.isNaN(submitted.getTime())
    ? null
    : submitted.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      {header}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded-lg bg-brand-navy/10 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-brand-navy">
          {intake.role}
        </span>
        {lenderChoice && (
          <span
            className={[
              "rounded-lg px-2.5 py-1 text-xs font-bold",
              lenderChoice === "mountain" || lenderChoice === "fastpass"
                ? "bg-green-100 text-green-700"
                : "bg-gray-100 text-gray-500",
            ].join(" ")}
          >
            {LENDER_LABELS[lenderChoice] ?? lenderChoice}
          </span>
        )}
        {submittedLabel && <span className="text-xs text-gray-400">Submitted {submittedLabel}</span>}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">The questionnaire was submitted without answers.</p>
      ) : (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {rows.map(({ key, label, value }) => (
            <div key={key} className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                {label}
              </dt>
              <dd className="mt-0.5 break-words text-sm font-medium text-brand-navy">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
