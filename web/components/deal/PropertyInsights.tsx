"use client";

import { BarChart3, Camera, Loader2, AlertTriangle } from "lucide-react";
import type { PropertyCondition, TrackedProperty } from "@/hooks/useProperties";
import { usePropertyComps, useAnalyzePhotos } from "@/hooks/usePropertyInsights";

const CONDITION_STYLE: Record<PropertyCondition, string> = {
  excellent: "bg-green-100 text-green-700",
  good: "bg-blue-100 text-blue-700",
  fair: "bg-amber-100 text-amber-700",
  poor: "bg-red-100 text-red-700",
  unknown: "bg-gray-100 text-gray-500",
};

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

const BTN =
  "flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:border-brand-navy/30 hover:text-brand-navy transition-colors disabled:opacity-50";

/**
 * Agent-facing Property-AI insights on the buy-side property card (#376):
 * a comp price RANGE (never a single number — Paul's call) and Claude-vision
 * photo tags. Both are on-demand (each is a paid, agent-only API call) and
 * purely informational — no price field is pre-filled.
 */
export default function PropertyInsights({ prop }: { prop: TrackedProperty }) {
  const comps = usePropertyComps(prop.dealId, prop.id);
  const photos = useAnalyzePhotos(prop.dealId, prop.id);
  const analysis = photos.data ?? prop.photoAnalysis;

  return (
    <div className="border-t border-gray-100 bg-white px-3 py-2.5 space-y-2.5">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
        AI Insights
      </p>

      {/* ── Comp range ─────────────────────────────────────────── */}
      <div className="space-y-1">
        {!comps.data && !comps.loading && (
          <button className={BTN} onClick={comps.run} disabled={comps.loading}>
            <BarChart3 size={12} /> Comp range
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

      {/* ── Photo tags ─────────────────────────────────────────── */}
      <div className="space-y-1.5">
        {photos.loading && (
          <p className="flex items-center gap-1.5 text-[11px] text-gray-400">
            <Loader2 size={12} className="animate-spin" /> Analyzing photos…
          </p>
        )}
        {photos.error && !photos.loading && (
          <p className="flex items-start gap-1 text-[11px] text-red-500">
            <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
            {photos.error}
          </p>
        )}

        {analysis ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${CONDITION_STYLE[analysis.condition]}`}
              >
                {analysis.condition}
              </span>
              <span className="text-[10px] text-gray-400">
                {analysis.photos_analyzed} photo{analysis.photos_analyzed === 1 ? "" : "s"} analyzed
              </span>
            </div>

            {analysis.features.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {analysis.features.map((f, i) => (
                  <span
                    key={`f${i}`}
                    className="rounded-full bg-green-50 text-green-700 px-2 py-0.5 text-[10px]"
                  >
                    {f}
                  </span>
                ))}
              </div>
            )}
            {analysis.flags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {analysis.flags.map((f, i) => (
                  <span
                    key={`x${i}`}
                    className="rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 text-[10px]"
                  >
                    {f}
                  </span>
                ))}
              </div>
            )}
            {analysis.summary && (
              <p className="text-[11px] text-gray-600 leading-snug">{analysis.summary}</p>
            )}
            <p className="text-[9px] text-gray-400 italic">{analysis.disclaimer}</p>
            <button className={BTN} onClick={() => photos.run()} disabled={photos.loading}>
              <Camera size={12} /> Re-analyze photos
            </button>
          </div>
        ) : (
          !photos.loading && (
            <button className={BTN} onClick={() => photos.run()} disabled={photos.loading}>
              <Camera size={12} /> Analyze photos
            </button>
          )
        )}
      </div>
    </div>
  );
}
