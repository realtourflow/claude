"use client";

import { Deal } from "@/lib/types";
import { MapPin, Calendar, Clock, CheckCircle2, Circle, Zap } from "lucide-react";
import { STAGE_LABELS, HEALTH_BORDER, HEALTH_BADGE, ClosingDaysBadge } from "@/components/deal/shared";

export function DealHeader({ deal, onFlagChange }: { deal: Deal; onFlagChange?: (flags: { preApproved?: boolean }) => void }) {
  const preApproved = deal.preApproved ?? false;

  return (
    <div className={`rounded-xl bg-white shadow-sm border-t-4 ${HEALTH_BORDER[deal.health]} px-5 py-4`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl font-bold text-brand-navy">{deal.clientName}</h1>
            {deal.type === 'buy' && (
              <button
                onClick={() => onFlagChange?.({ preApproved: !preApproved })}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-all border ${
                  preApproved
                    ? 'bg-green-100 text-green-700 border-green-200 hover:bg-green-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                }`}
              >
                {preApproved ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                {preApproved ? 'Pre-Approved ✓' : 'Pre-approved?'}
              </button>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-sm text-gray-400">
            <MapPin size={13} />
            <span className="truncate">{deal.property.address}, {deal.property.city}, {deal.property.state} {deal.property.zip}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-sm font-semibold ${HEALTH_BADGE[deal.health]}`}>
              {STAGE_LABELS[deal.stage]}
            </span>
            <span className="rounded-full bg-brand-navy/10 px-3 py-1 text-sm font-medium text-brand-navy capitalize">
              {deal.type === 'buy' ? 'Purchase' : 'Listing'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {deal.fastPass?.status === 'active' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 border border-green-200 px-2 py-0.5 text-[11px] font-bold text-green-700">
                <Zap size={10} /> Fast Pass
              </span>
            )}
            {deal.smoothExit?.status === 'active' && (
              <span className="rounded-full bg-purple-100 border border-purple-200 px-2 py-0.5 text-[11px] font-bold text-purple-700">
                Smooth Exit
              </span>
            )}
          </div>
        </div>
      </div>
      {deal.timeline.closingDate && (
        <div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
          <Calendar size={11} />
          <span>Closing {deal.timeline.closingDate}</span>
          <ClosingDaysBadge closingDate={deal.timeline.closingDate} />
          <span className="mx-1">·</span>
          <Clock size={11} />
          <span>{deal.timeline.daysInStage} days in current stage</span>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
