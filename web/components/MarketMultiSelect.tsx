"use client";

import { Check } from "lucide-react";
import { MARKETS, MARKET_GROUPS } from "@/lib/markets";

/**
 * Grouped market picker — select one or MORE markets from the canonical list
 * (no typing). Shared by agent onboarding and Settings → Profile so the two
 * stay identical. The first selected market is the agent's primary market.
 */
export default function MarketMultiSelect({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (markets: string[]) => void;
}) {
  function toggle(code: string) {
    onChange(
      selected.includes(code)
        ? selected.filter((c) => c !== code)
        : [...selected, code]
    );
  }

  return (
    <div className="space-y-4">
      {MARKET_GROUPS.map((group) => (
        <div key={group}>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-400">
            {group}
          </p>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {MARKETS.filter((m) => m.group === group).map((m) => {
              const on = selected.includes(m.code);
              const isPrimary = on && selected[0] === m.code;
              return (
                <button
                  key={m.code}
                  type="button"
                  onClick={() => toggle(m.code)}
                  className={[
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-all",
                    on
                      ? "border-brand-navy bg-brand-navy/5 text-brand-navy"
                      : "border-gray-200 text-gray-600 hover:border-gray-300",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border",
                      on ? "border-brand-navy bg-brand-navy text-white" : "border-gray-300 bg-white",
                    ].join(" ")}
                  >
                    {on && <Check size={11} />}
                  </span>
                  <span className="flex-1">{m.label}</span>
                  {isPrimary && selected.length > 1 && (
                    <span className="flex-shrink-0 rounded-full bg-brand-navy/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-navy">
                      Primary
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
