"use client";

import { BarChart3, Loader2, AlertTriangle } from "lucide-react";
import type { TrackedProperty } from "@/hooks/useProperties";
import { usePropertyComps } from "@/hooks/usePropertyInsights";

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

const BTN =
  "flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:border-brand-navy/30 hover:text-brand-navy transition-colors disabled:opacity-50";

/**
 * Agent-facing Property-AI insight on the buy-side property card (#376): a comp
 * price RANGE (never a single number — Paul's call). On-demand (a paid,
 * agent-only API call) and purely informational — no price field is pre-filled.
 *
 * Photo-tag analysis was deliberately dropped: agents already look at every
 * listing photo themselves, so an AI read of one thumbnail duplicated the
 * agent's own quick judgment for no real gain. Comps automate the genuinely
 * tedious part (pulling recent sold sales); photo tags did not.
 */
export default function PropertyInsights({ prop }: { prop: TrackedProperty }) {
  const comps = usePropertyComps(prop.dealId, prop.id);

  return (
    <div className="border-t border-gray-100 bg-white px-3 py-2.5 space-y-1">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
        Comp range
      </p>

      {!comps.data && !comps.loading && (
        <button className={BTN} onClick={comps.run} disabled={comps.loading}>
          <BarChart3 size={12} /> Pull comps
        </button>
      )}
      {comps.loading && (
        <p className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <Loader2 size={12} className="animate-spin" /> Pulling comps…
        </p>
      )}
      {comps.error && (
        <p className="flex items-start gap-1 text-[11px] text-gray-500">
          <AlertTriangle size={11} className="text-amber-500 flex-shrink-0 mt-0.5" />
          {comps.error}
        </p>
      )}
      {comps.data && comps.data.range && (
        <div>
          <p className="text-sm font-bold text-brand-navy">
            {money(comps.data.range.low)} – {money(comps.data.range.high)}
          </p>
          <p className="text-[10px] text-gray-400">
            {comps.data.comp_count} sold comp{comps.data.comp_count === 1 ? "" : "s"}
            {comps.data.tier_used ? ` · ${comps.data.tier_used}` : ""}
            {comps.data.widened ? " · widened" : ""}
          </p>
          {prop.offerRequested && (
            <p className="mt-0.5 text-[10px] text-amber-700">
              Guidance for the buyer&apos;s offer — you decide the number.
            </p>
          )}
          <p className="mt-0.5 text-[9px] text-gray-400 italic">{comps.data.disclaimer}</p>
          <button className={`${BTN} mt-1`} onClick={comps.run} disabled={comps.loading}>
            <BarChart3 size={12} /> Refresh
          </button>
        </div>
      )}
      {comps.data && !comps.data.range && (
        <p className="text-[11px] text-gray-500">
          {comps.data.reason === "insufficient_comps"
            ? `Only ${comps.data.comp_count} comparable sale${comps.data.comp_count === 1 ? "" : "s"} found — not enough for a range.`
            : "No comparable sales found nearby."}
        </p>
      )}
    </div>
  );
}
