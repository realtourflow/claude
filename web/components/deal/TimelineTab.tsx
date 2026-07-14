"use client";

import { useMemo } from "react";
import { Deal, DealStage, Task } from "@/lib/types";
import MetroMap from "@/components/MetroMap";
import { CheckCircle2, AlertCircle, Zap } from "lucide-react";
import { STAGE_LABELS, STAGE_ORDER } from "@/components/deal/shared";
import { useStageHistory } from "@/hooks/useStageHistory";

const MS_PER_DAY = 86_400_000;

export function TimelineTab({ deal, tasks }: { deal: Deal; tasks: Task[] }) {
  const currentStageIndex = STAGE_ORDER.indexOf(deal.stage);

  // Real per-stage durations from deal_stage_history (#256): the gap between
  // consecutive transitions, and created_at -> the first transition for the
  // initial stage. Keyed by the stage that was departed (each row's
  // from_stage). The current stage has no departure row yet, so it shows the
  // live "so far" counter below instead of a finished duration.
  const { history } = useStageHistory(deal.id);
  const stageDays = useMemo(() => {
    const out: Partial<Record<DealStage, number>> = {};
    let prev = new Date(deal.timeline.createdAt).getTime();
    for (const row of history) {
      const t = new Date(row.changed_at).getTime();
      const days = Math.round((t - prev) / MS_PER_DAY);
      if (row.from_stage && Number.isFinite(days)) {
        out[row.from_stage as DealStage] = Math.max(0, days);
      }
      prev = t;
    }
    return out;
  }, [history, deal.timeline.createdAt]);

  return (
    <div className="space-y-3">
      {STAGE_ORDER.map((stage, i) => {
        const isCurrent = stage === deal.stage;
        const isPast = i < currentStageIndex;
        const isFuture = i > currentStageIndex;

        const stageTasks = tasks.filter((t) => t.stageContext === stage);
        const completed = stageTasks.filter((t) => t.status === 'completed').length;
        const total = stageTasks.length;
        const hasOverdue = stageTasks.some((t) => t.status === 'overdue');
        const hasInProgress = stageTasks.some((t) => t.status === 'in_progress');

        let dotColor = 'bg-gray-200';
        if (isPast) dotColor = 'bg-green-400';
        if (isCurrent && hasOverdue) dotColor = 'bg-red-400';
        if (isCurrent && !hasOverdue && hasInProgress) dotColor = 'bg-blue-400';
        if (isCurrent && !hasOverdue && !hasInProgress) dotColor = 'bg-brand-gold';

        return (
          <div key={stage} className="flex gap-4">
            {/* Left: dot + line */}
            <div className="flex flex-col items-center">
              <div className={`h-3 w-3 rounded-full flex-shrink-0 mt-1.5 ${dotColor} ${isCurrent ? 'ring-2 ring-offset-2 ring-brand-gold/60' : ''}`} />
              {i < STAGE_ORDER.length - 1 && (
                <div className={`w-0.5 flex-1 mt-1 min-h-[24px] ${isPast ? 'bg-green-200' : 'bg-gray-100'}`} />
              )}
            </div>

            {/* Right: content */}
            <div className={`flex-1 rounded-xl px-4 py-3 mb-2 ${
              isCurrent
                ? 'bg-white shadow-sm border border-brand-gold/30'
                : isPast
                ? 'bg-white/60 shadow-sm'
                : 'bg-white/30'
            }`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm font-semibold ${isFuture ? 'text-gray-400' : 'text-brand-navy'}`}>
                    {STAGE_LABELS[stage]}
                  </span>
                  {isCurrent && (
                    <span className="rounded-full bg-brand-gold/20 px-2 py-0.5 text-[10px] font-bold text-brand-navy uppercase tracking-wide">
                      Current
                    </span>
                  )}
                  {isPast && (
                    <CheckCircle2 size={13} className="text-green-500" />
                  )}
                  {/* Days spent */}
                  {isCurrent && (
                    <span className="text-[11px] font-medium text-gray-400">
                      {deal.timeline.daysInStage}d so far
                    </span>
                  )}
                  {isPast && stageDays[stage] !== undefined && (
                    <span className="text-[11px] font-medium text-gray-400">
                      {`${stageDays[stage]}d`}
                    </span>
                  )}
                </div>
                {total > 0 && (
                  <div className="flex items-center gap-2">
                    {/* Task dots with styled tooltip */}
                    {stageTasks.slice(0, 10).map((t) => (
                      <div key={t.id} className="relative group/dot flex-shrink-0">
                        <span
                          className={`block h-3 w-3 rounded-full cursor-default transition-transform group-hover/dot:scale-125 ${
                            t.status === 'completed' ? 'bg-green-400' :
                            t.status === 'overdue' ? 'bg-red-400' :
                            t.status === 'in_progress' ? 'bg-blue-400' :
                            'bg-gray-300'
                          }`}
                        />
                        <div className="pointer-events-none absolute bottom-full right-0 mb-2 z-50 hidden group-hover/dot:block">
                          <div className="rounded-lg bg-gray-900 px-2.5 py-1.5 shadow-lg whitespace-nowrap">
                            <p className="text-xs font-medium text-white leading-snug max-w-[180px] truncate">{t.title}</p>
                            <p className={`text-[10px] mt-0.5 font-semibold uppercase tracking-wide ${
                              t.status === 'completed' ? 'text-green-400' :
                              t.status === 'overdue' ? 'text-red-400' :
                              t.status === 'in_progress' ? 'text-blue-400' :
                              'text-gray-400'
                            }`}>
                              {t.status.replace('_', ' ')}
                            </p>
                          </div>
                          <div className="ml-auto mr-1 h-1.5 w-1.5 -mt-1 rotate-45 bg-gray-900 rounded-sm" />
                        </div>
                      </div>
                    ))}
                    {total > 10 && (
                      <span className="text-[10px] font-semibold text-gray-400">+{total - 10}</span>
                    )}
                    <span className="text-xs font-bold text-gray-500 ml-0.5">{completed}/{total}</span>
                  </div>
                )}
              </div>
              {isCurrent && hasOverdue && (
                <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle size={11} /> Overdue tasks need attention
                </p>
              )}
            </div>
          </div>
        );
      })}

      {/* Metro Map for Under Contract deals */}
      {deal.stage === 'under_contract' && (
        <div className="mt-2">
          <div className="mb-2 flex items-center gap-2">
            <Zap size={14} className="text-brand-gold" />
            <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Metro Map</span>
          </div>
          <MetroMap deal={deal} />
        </div>
      )}
    </div>
  );
}

// ─── Stage Advance Automation Modal ──────────────────────────────────────────
