"use client";

import React, { useState } from 'react';
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuthStore } from "@/lib/store/authStore";
import { Deal, LoanMilestones } from "@/lib/data/mockDeals";
import { useDeals } from "@/hooks/useDeals";
import { useContingencies, useAllContingenciesForDeals, ContingencyStatus, ContingencyType } from "@/hooks/useContingencies";
import { useChecklist, ChecklistAssignee } from "@/hooks/useChecklist";
import { useAgentTasks } from "@/hooks/useTasks";
import { usePermission } from "@/permissions/usePermission";
import { PERMISSIONS } from "@/permissions/permissions";
import {
  AlertTriangle, CheckCircle2, Circle, FileText,
  CalendarClock, ClipboardList, Loader2, AlertCircle,
  CheckSquare, RefreshCw, Pencil, Building2, Plus, X, Lock,
  Shield, ShieldCheck, ShieldOff, Phone, Copy, Zap,
  CalendarDays, User, FileCheck, Eye, FileX, Upload, ChevronDown,
} from 'lucide-react';

// ─── Documents mock data ──────────────────────────────────────────────────────

type DocStatus = 'signed' | 'pending_signature' | 'pending_review' | 'missing' | 'uploaded';

type DocRecord = {
  id: string;
  name: string;
  status: DocStatus;
  date: string;
  required: boolean;
};

const INIT_DOCS: Record<string, DocRecord[]> = {
  'deal-smith': [
    { id: 'ds1', name: 'Purchase Agreement',          status: 'signed',            date: '2026-02-01', required: true  },
    { id: 'ds2', name: 'ARIVE Disclosures',            status: 'pending_signature', date: '2026-02-12', required: true  },
    { id: 'ds3', name: 'Inspection Report',            status: 'pending_review',    date: '2026-02-10', required: true  },
    { id: 'ds4', name: 'Proof of Funds',               status: 'missing',           date: '—',          required: true  },
    { id: 'ds5', name: 'Title Commitment',             status: 'pending_review',    date: '2026-02-14', required: true  },
    { id: 'ds6', name: 'Homeowners Insurance Binder',  status: 'missing',           date: '—',          required: true  },
  ],
  'deal-williams': [
    { id: 'dw1', name: 'Listing Agreement',            status: 'signed',            date: '2026-01-10', required: true  },
    { id: 'dw2', name: 'Seller Disclosures',           status: 'signed',            date: '2026-01-12', required: true  },
    { id: 'dw3', name: 'Purchase Agreement',           status: 'signed',            date: '2026-02-01', required: true  },
    { id: 'dw4', name: 'Repair Request Response',      status: 'pending_review',    date: '2026-02-13', required: false },
    { id: 'dw5', name: 'Wire Instructions',            status: 'missing',           date: '—',          required: true  },
    { id: 'dw6', name: 'Settlement Statement',         status: 'missing',           date: '—',          required: true  },
  ],
};

const DOC_STATUS: Record<DocStatus, { label: string; style: string; dot: string; Icon: React.ElementType }> = {
  signed:            { label: 'Signed',          style: 'bg-green-100 text-green-700', dot: 'bg-green-400',  Icon: FileCheck },
  pending_review:    { label: 'Review needed',   style: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400',  Icon: Eye       },
  pending_signature: { label: 'Needs signature', style: 'bg-red-100 text-red-700',     dot: 'bg-red-400',    Icon: Pencil    },
  missing:           { label: 'Missing',         style: 'bg-gray-100 text-gray-500',   dot: 'bg-gray-300',   Icon: FileX     },
  uploaded:          { label: 'Uploaded',        style: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-400',   Icon: Upload    },
};

// ─── Shared helpers ───────────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  intake:           'Intake',
  active_search:    'Active Search',
  offer_active:     'Offer Active',
  under_contract:   'Under Contract',
  pre_close:        'Pre-Close',
  closing:          'Closing',
  post_close:       'Post-Close',
};

const HEALTH_BORDER: Record<string, string> = {
  green:  'border-l-green-400',
  yellow: 'border-l-amber-400',
  red:    'border-l-red-500',
};

const HEALTH_BADGE: Record<string, string> = {
  green:  'bg-green-100 text-green-700',
  yellow: 'bg-amber-100 text-amber-700',
  red:    'bg-red-100 text-red-700',
};

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

function useMyDeals() {
  const { deals } = useDeals();
  return deals;
}

// ─── Deal card ────────────────────────────────────────────────────────────────

function DealCard({ deal }: { deal: Deal }) {
  const openTasks    = deal.openTaskCount ?? 0;
  const overdueTasks = deal.overdueTaskCount ?? 0;

  const { items: contingencies } = useContingencies(deal.id);
  const activeC = contingencies.filter((c) => c.status === 'active');
  const today = new Date();
  const urgentC = activeC.filter((c) => {
    if (!c.deadline) return false;
    const d = new Date(c.deadline);
    return (d.getTime() - today.getTime()) / 86_400_000 <= 5;
  });

  const closing     = deal.timeline.closingDate;
  const closingDays = closing ? daysUntil(closing) : null;

  return (
    <Link
      href={`/tc/deals/${deal.id}`}
      className={`block border-l-4 ${HEALTH_BORDER[deal.health]} rounded-r-xl bg-white shadow-sm p-5 hover:shadow-md transition-shadow`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="font-bold text-brand-navy">{deal.clientName}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${deal.type === 'buy' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
              {deal.type}
            </span>
            {deal.flags.includes('fast_pass') && (
              <span className="flex items-center gap-0.5 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-bold text-green-700">
                <Zap size={9} /> Fast Pass
              </span>
            )}
            {deal.flags.includes('repair_request') && (
              <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-700">
                Repair Req.
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400">{deal.property.address}, {deal.property.city}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold flex-shrink-0 ${HEALTH_BADGE[deal.health]}`}>
          {STAGE_LABELS[deal.stage]}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className={`flex items-center gap-1.5 ${overdueTasks > 0 ? 'text-red-600' : 'text-gray-500'}`}>
          <CheckSquare size={12} />
          <span>{openTasks} task{openTasks !== 1 ? 's' : ''}</span>
          {overdueTasks > 0 && (
            <span className="rounded-full bg-red-100 px-1 text-[10px] font-bold text-red-600">{overdueTasks}!</span>
          )}
        </div>
        <div className={`flex items-center gap-1.5 ${urgentC.length > 0 ? 'text-amber-600' : 'text-gray-500'}`}>
          <Shield size={12} />
          <span>{activeC.length} contg.</span>
          {urgentC.length > 0 && (
            <span className="rounded-full bg-amber-100 px-1 text-[10px] font-bold text-amber-600">!</span>
          )}
        </div>
        {closing ? (
          <div className={`flex items-center gap-1.5 ${
            closingDays !== null && closingDays < 0   ? 'text-red-500' :
            closingDays !== null && closingDays <= 14 ? 'text-amber-600' :
                                                        'text-gray-400'
          }`}>
            <CalendarClock size={12} />
            <span>
              {closingDays === null  ? '—' :
               closingDays < 0      ? `${Math.abs(closingDays)}d past` :
               closingDays === 0    ? 'Today!' :
               `${closingDays}d left`}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-gray-300">
            <CalendarClock size={12} />
            <span>No close date</span>
          </div>
        )}
      </div>

      {deal.agentName && (
        <div className="mt-3 flex items-center gap-2 pt-3 border-t border-gray-50">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-navy/10 text-[9px] font-bold text-brand-navy flex-shrink-0">
            {deal.agentName.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <span className="text-xs text-gray-400">Agent: {deal.agentName}</span>
        </div>
      )}
    </Link>
  );
}

// ─── My Transactions ──────────────────────────────────────────────────────────

function MyTransactions() {
  const activeUser   = useAuthStore((s) => s.activeUser);
  const deals        = useMyDeals();

  const overdueTasks = { length: deals.reduce((sum, d) => sum + (d.overdueTaskCount ?? 0), 0) };

  const allContingencies = useAllContingenciesForDeals(deals.map((d) => d.id));
  const today = new Date();
  const urgentC = allContingencies.filter((c) => {
    if (c.status !== 'active' || !c.deadline) return false;
    return (new Date(c.deadline).getTime() - today.getTime()) / 86_400_000 <= 5;
  });
  const closingThisMonth = deals.filter((d) => {
    if (!d.timeline.closingDate) return false;
    const days = daysUntil(d.timeline.closingDate);
    return days >= 0 && days <= 30;
  });
  const redDeals = deals.filter((d) => d.health === 'red');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">My Transactions</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {activeUser?.name} · {deals.length} active file{deals.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Active Files',          value: deals.length,          icon: FileText,      accent: 'text-brand-navy' },
          { label: 'Overdue Tasks',          value: overdueTasks.length,   icon: AlertTriangle, accent: overdueTasks.length > 0 ? 'text-red-600' : 'text-brand-navy' },
          { label: 'Urgent Contingencies',   value: urgentC.length,        icon: Shield,        accent: urgentC.length > 0 ? 'text-amber-600' : 'text-brand-navy' },
          { label: 'Closing This Month',     value: closingThisMonth.length, icon: CalendarClock, accent: closingThisMonth.length > 0 ? 'text-blue-600' : 'text-brand-navy' },
        ].map(({ label, value, icon: Icon, accent }) => (
          <div key={label} className="flex items-center gap-3 rounded-xl bg-white px-4 py-3.5 shadow-sm">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-navy/5 text-brand-navy">
              <Icon size={16} />
            </div>
            <div>
              <div className={`text-xl font-bold ${accent}`}>{value}</div>
              <div className="text-[11px] text-gray-400 font-medium leading-tight">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Critical deal alert */}
      {redDeals.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-100 px-4 py-3.5">
          <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700">
              {redDeals.map((d) => d.clientName).join(', ')} — needs immediate attention
            </p>
            <p className="text-xs text-red-400 mt-0.5">Deal health is critical. Review tasks and contingencies now.</p>
          </div>
        </div>
      )}

      {/* Deal cards */}
      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">Active Files</h2>
        <div className="space-y-3">
          {deals.map((d) => <DealCard key={d.id} deal={d} />)}
        </div>
      </section>
    </div>
  );
}

// ─── Deadlines ────────────────────────────────────────────────────────────────

type DeadlineEntry = {
  id: string;
  dealId: string;
  title: string;
  dueDate: string;
  assignedTo: string;
  status: 'pending' | 'in_progress' | 'overdue' | 'completed' | 'blocked';
  source: 'task' | 'checklist' | 'contingency';
};

function Deadlines() {
  const deals            = useMyDeals();
  const { tasks }        = useAgentTasks();
  const allContingencies = useAllContingenciesForDeals(deals.map((d) => d.id));

  const taskEntries: DeadlineEntry[] = tasks
    .filter((t) => t.dueDate && t.status !== 'completed')
    .map((t) => ({
      id: t.id,
      dealId: t.dealId,
      title: t.title,
      dueDate: t.dueDate!,
      assignedTo: t.assignedTo ?? 'agent',
      status: t.status as DeadlineEntry['status'],
      source: 'task' as const,
    }));

  const checklistEntries: DeadlineEntry[] = [];

  const contingencyEntries: DeadlineEntry[] = allContingencies
    .filter((c) => c.status === 'active' && c.deadline)
    .map((c) => ({
      id: c.id,
      dealId: c.dealId,
      title: c.label,
      dueDate: c.deadline!,
      assignedTo: 'tc',
      status: 'pending' as const,
      source: 'contingency' as const,
    }));

  const all = [...taskEntries, ...checklistEntries, ...contingencyEntries]
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const overdue  = all.filter((t) => daysUntil(t.dueDate) < 0);
  const today    = all.filter((t) => daysUntil(t.dueDate) === 0);
  const soon     = all.filter((t) => daysUntil(t.dueDate) > 0 && daysUntil(t.dueDate) <= 7);
  const upcoming = all.filter((t) => daysUntil(t.dueDate) > 7);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Deadlines</h1>
        <p className="text-sm text-gray-400 mt-0.5">Tasks, checklists, and contingency deadlines across your files</p>
      </div>
      {all.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white py-16 shadow-sm text-center">
          <CheckCircle2 size={32} className="mx-auto mb-2 text-green-400" />
          <p className="text-sm text-gray-400">No open deadlines — nice work!</p>
        </div>
      ) : (
        <div className="space-y-6">
          <DeadlineGroup title="Overdue"      items={overdue}  accent="text-red-600"   deals={deals} />
          <DeadlineGroup title="Today"        items={today}    accent="text-amber-600" deals={deals} />
          <DeadlineGroup title="Next 7 Days"  items={soon}     accent="text-amber-500" deals={deals} />
          <DeadlineGroup title="Upcoming"     items={upcoming} accent="text-gray-400"  deals={deals} />
        </div>
      )}
    </div>
  );
}

// ─── Module-scope helpers for Deadlines (hoisted to satisfy
// react-hooks/static-components) ─────────────────────────────────────────────

const SOURCE_BADGE: Record<string, string> = {
  task:        'bg-brand-navy/10 text-brand-navy/60',
  checklist:   'bg-purple-100 text-purple-600',
  contingency: 'bg-amber-100 text-amber-700',
};

const ENTRY_ICON: Record<string, React.ReactNode> = {
  overdue:     <AlertCircle size={15} className="text-red-500 flex-shrink-0" />,
  in_progress: <Loader2 size={15} className="text-blue-500 flex-shrink-0 animate-spin" />,
  pending:     <Circle size={15} className="text-gray-300 flex-shrink-0" />,
  completed:   <CheckCircle2 size={15} className="text-green-500 flex-shrink-0" />,
  blocked:     <AlertCircle size={15} className="text-orange-400 flex-shrink-0" />,
};

const ASSIGNEE_STYLE: Record<string, string> = {
  agent: 'bg-blue-100 text-blue-700', buyer: 'bg-green-100 text-green-700',
  seller: 'bg-purple-100 text-purple-700', tc: 'bg-amber-100 text-amber-700',
  third_party: 'bg-gray-100 text-gray-500', admin: 'bg-gray-100 text-gray-500',
};

function DeadlineRow({ entry, deals }: { entry: DeadlineEntry; deals: Deal[] }) {
  const deal = deals.find((d) => d.id === entry.dealId)!;
  const days = daysUntil(entry.dueDate);
  const isOverdue = days < 0;
  const isToday   = days === 0;
  const isSoon    = days > 0 && days <= 3;
  return (
    <div className={`flex items-center gap-3 rounded-xl px-4 py-3 ${
      isOverdue ? 'bg-red-50 border border-red-100' :
      isToday   ? 'bg-amber-50 border border-amber-100' :
                  'bg-white border border-gray-100'
    }`}>
      {ENTRY_ICON[entry.status]}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className={`text-sm font-semibold truncate ${isOverdue ? 'text-red-800' : 'text-brand-navy'}`}>
            {entry.title}
          </p>
          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase flex-shrink-0 ${SOURCE_BADGE[entry.source]}`}>
            {entry.source}
          </span>
        </div>
        <p className="text-xs text-gray-400 truncate">{deal?.clientName} · {STAGE_LABELS[deal?.stage]}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <div className={`text-xs font-bold ${isOverdue ? 'text-red-600' : isToday ? 'text-amber-600' : isSoon ? 'text-amber-500' : 'text-gray-400'}`}>
          {isOverdue ? `${Math.abs(days)}d overdue` : isToday ? 'Today' : `${days}d`}
        </div>
        <div className="text-[10px] text-gray-300">{entry.dueDate}</div>
      </div>
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase flex-shrink-0 ${ASSIGNEE_STYLE[entry.assignedTo] ?? 'bg-gray-100 text-gray-500'}`}>
        {entry.assignedTo}
      </span>
    </div>
  );
}

function DeadlineGroup({ title, items, accent, deals }: { title: string; items: DeadlineEntry[]; accent: string; deals: Deal[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className={`text-xs font-bold uppercase tracking-wider ${accent}`}>{title}</h2>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500">{items.length}</span>
      </div>
      <div className="space-y-2">{items.map((t) => <DeadlineRow key={t.id} entry={t} deals={deals} />)}</div>
    </section>
  );
}

// ─── Contingencies ────────────────────────────────────────────────────────────

const CONTINGENCY_TYPE_ICON: Record<ContingencyType, React.ElementType> = {
  inspection: Shield,
  financing:  Building2,
  appraisal:  ClipboardList,
  hoa:        CheckSquare,
  custom:     ClipboardList,
};

const CONTINGENCY_STATUS: Record<ContingencyStatus, { badge: string; label: string; Icon: React.ElementType }> = {
  active:  { badge: 'bg-amber-100 text-amber-700', label: 'Active',  Icon: Shield      },
  waived:  { badge: 'bg-green-100 text-green-700', label: 'Waived',  Icon: ShieldCheck },
  removed: { badge: 'bg-gray-100 text-gray-500',   label: 'Removed', Icon: ShieldOff   },
};

function DealContingenciesCard({ deal }: { deal: Deal }) {
  const { items, updateStatus, loading } = useContingencies(deal.id);

  const activeCount = items.filter((c) => c.status === 'active').length;
  const urgentCount = items.filter((c) => c.status === 'active' && c.deadline && daysUntil(c.deadline) <= 5).length;

  return (
    <div className="rounded-xl bg-white shadow-sm overflow-hidden">
      {/* Deal header */}
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-50">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-brand-navy">{deal.clientName}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${deal.type === 'buy' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
              {deal.type}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{deal.property.address} · {STAGE_LABELS[deal.stage]}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {urgentCount > 0 && (
            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-600">
              {urgentCount} urgent
            </span>
          )}
          <span className="text-xs text-gray-400">{activeCount} active</span>
        </div>
      </div>

      {/* Contingency rows */}
      {loading ? (
        <div className="px-5 py-4 text-xs text-gray-300">Loading…</div>
      ) : items.length === 0 ? (
        <div className="px-5 py-4 text-xs text-gray-300 italic">No contingencies for this deal</div>
      ) : (
        <div className="divide-y divide-gray-50">
          {items.map((c) => {
            const s          = CONTINGENCY_STATUS[c.status];
            const StatusIcon = s.Icon;
            const TypeIcon   = CONTINGENCY_TYPE_ICON[c.type];
            const days       = c.deadline ? daysUntil(c.deadline) : null;
            const isUrgent   = days !== null && days <= 5 && c.status === 'active';
            const isPast     = days !== null && days < 0  && c.status === 'active';

            return (
              <div key={c.id} className={`flex items-center gap-4 px-5 py-3.5 ${isUrgent ? 'bg-amber-50/50' : ''}`}>
                <TypeIcon size={15} className="text-gray-300 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-semibold ${c.status === 'active' ? 'text-brand-navy' : 'text-gray-400'}`}>
                      {c.label}
                    </span>
                    <span className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${s.badge}`}>
                      <StatusIcon size={9} className="inline" /> {s.label}
                    </span>
                  </div>
                  {c.deadline && c.status === 'active' && (
                    <div className={`text-xs mt-0.5 ${isPast ? 'text-red-600 font-semibold' : isUrgent ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
                      {isPast
                        ? `Expired ${Math.abs(days!)}d ago — ${c.deadline}`
                        : days === 0
                        ? `Expires today — ${c.deadline}`
                        : `Expires in ${days}d — ${c.deadline}`}
                    </div>
                  )}
                  {c.status !== 'active' && c.deadline && (
                    <div className="text-xs text-gray-300 mt-0.5">Deadline was {c.deadline}</div>
                  )}
                </div>

                {c.status === 'active' && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => updateStatus(c.id, 'waived')}
                      className="rounded-lg border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700 hover:bg-green-100 transition-colors"
                    >
                      Mark Waived
                    </button>
                    <button
                      onClick={() => updateStatus(c.id, 'removed')}
                      className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ContingenciesSection() {
  const deals = useMyDeals();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Contingencies</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Track active contingency periods. Mark waived or removed once resolved.
        </p>
      </div>
      {deals.map((deal) => <DealContingenciesCard key={deal.id} deal={deal} />)}
    </div>
  );
}

// ─── Documents ────────────────────────────────────────────────────────────────

function Documents() {
  const deals = useMyDeals();
  const [docs, setDocs] = useState(INIT_DOCS);

  function markOK(dealId: string, docId: string) {
    setDocs((prev) => ({
      ...prev,
      [dealId]: prev[dealId].map((d) =>
        d.id === docId
          ? { ...d, status: 'signed' as DocStatus, date: new Date().toISOString().slice(0, 10) }
          : d,
      ),
    }));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Documents</h1>
        <p className="text-sm text-gray-400 mt-0.5">Track and action all required documents across your files</p>
      </div>

      {deals.map((deal) => {
        const dealDocs    = docs[deal.id] ?? [];
        const total       = dealDocs.length;
        const signed      = dealDocs.filter((d) => d.status === 'signed').length;
        const pct         = total > 0 ? Math.round((signed / total) * 100) : 0;
        const needsAction = dealDocs.filter((d) => d.status !== 'signed').length;

        return (
          <section key={deal.id}>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <h2 className="text-sm font-bold text-brand-navy">{deal.clientName}</h2>
              <span className="text-xs text-gray-400">{deal.property.address}</span>
              <span className="ml-auto text-xs font-semibold text-gray-500">{signed}/{total} complete</span>
              {needsAction > 0 && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                  {needsAction} need action
                </span>
              )}
            </div>

            {/* Progress bar */}
            <div className="mb-2 h-1.5 rounded-full bg-gray-100">
              <div
                className={`h-1.5 rounded-full transition-all duration-300 ${pct === 100 ? 'bg-green-400' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400'}`}
                style={{ width: `${pct}%` }}
              />
            </div>

            <div className="rounded-xl bg-white shadow-sm overflow-hidden">
              {dealDocs.map((doc, i) => {
                const s = DOC_STATUS[doc.status];
                const DocIcon = s.Icon;
                return (
                  <div
                    key={doc.id}
                    className={`flex items-center gap-3 px-4 py-3 ${i < dealDocs.length - 1 ? 'border-b border-gray-50' : ''}`}
                  >
                    <span className={`h-2 w-2 rounded-full flex-shrink-0 ${s.dot}`} />
                    <DocIcon size={14} className="text-gray-300 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-brand-navy truncate">{doc.name}</p>
                        {doc.required && (
                          <span className="text-[9px] font-bold text-gray-300 uppercase flex-shrink-0">Required</span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-400">{doc.date}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold flex-shrink-0 ${s.style}`}>
                      {s.label}
                    </span>
                    {doc.status === 'missing' && (
                      <button className="rounded-lg bg-brand-navy px-2.5 py-1 text-[11px] font-bold text-white hover:bg-brand-navy/80 transition-colors flex-shrink-0">
                        Request
                      </button>
                    )}
                    {doc.status === 'pending_signature' && (
                      <button className="rounded-lg bg-red-500 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-red-600 transition-colors flex-shrink-0">
                        Send Reminder
                      </button>
                    )}
                    {doc.status === 'pending_review' && (
                      <button
                        onClick={() => markOK(deal.id, doc.id)}
                        className="rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-600 transition-colors flex-shrink-0"
                      >
                        Mark OK
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ─── Loan Milestones ──────────────────────────────────────────────────────────

const BOOL_CHECKS: {
  key: keyof Pick<LoanMilestones, 'loanSetup' | 'disclosuresOut' | 'disclosuresSignedSubmitted' | 'approvedWithConditions' | 'resubmittal' | 'clearToClose'>;
  label: string;
}[] = [
  { key: 'loanSetup',                  label: 'Loan Setup'           },
  { key: 'disclosuresOut',             label: 'Disclosures Out'      },
  { key: 'disclosuresSignedSubmitted', label: 'Disclosures Signed'   },
  { key: 'approvedWithConditions',     label: 'Approved w/ Cond.'    },
  { key: 'resubmittal',                label: 'Resubmittal'          },
  { key: 'clearToClose',               label: 'Clear to Close'       },
];

function MilestonesCard({ deal }: { deal: Deal }) {
  const [milestones, setMilestones] = useState<LoanMilestones>(deal.loanMilestones!);
  const lender  = deal.vendors?.lender;
  const isArive = milestones.source === 'arive';
  const pendingSignature = milestones.disclosuresOut && !milestones.disclosuresSignedSubmitted;

  const completedCount = BOOL_CHECKS.filter(({ key }) => milestones[key]).length;
  const total          = BOOL_CHECKS.length;
  const pct            = Math.round((completedCount / total) * 100);

  function toggle(key: typeof BOOL_CHECKS[number]['key']) {
    if (isArive) return;
    setMilestones((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className={`rounded-xl bg-white shadow-sm p-5 ${pendingSignature ? 'border border-amber-200' : ''}`}>
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-brand-navy">{deal.clientName}</span>
            <span className="text-xs text-gray-400">{deal.property.address}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <Building2 size={11} className="text-gray-400 flex-shrink-0" />
            <span className="text-xs text-gray-500 font-medium">{lender?.company ?? 'No lender assigned'}</span>
            {lender && (
              isArive ? (
                <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
                  <RefreshCw size={8} /> ARIVE Synced
                </span>
              ) : (
                <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                  <Pencil size={8} /> Manual — click to update
                </span>
              )
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right">
            <div className="text-sm font-bold text-brand-navy">{completedCount}/{total}</div>
            <div className="text-[10px] text-gray-400">milestones</div>
          </div>
          {pendingSignature && (
            <button className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 transition-colors flex-shrink-0">
              Send Reminder
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-4 h-1.5 rounded-full bg-gray-100">
        <div
          className={`h-1.5 rounded-full transition-all duration-300 ${pct === 100 ? 'bg-green-400' : pct >= 50 ? 'bg-amber-400' : 'bg-brand-navy/40'}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Milestone grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 mb-4">
        {BOOL_CHECKS.map(({ key, label }) => {
          const checked = milestones[key] as boolean;
          return (
            <button
              key={key}
              onClick={() => toggle(key)}
              disabled={isArive}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                checked ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-400'
              } ${!isArive ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}
            >
              {checked
                ? <CheckCircle2 size={13} className="text-green-500 flex-shrink-0" />
                : <Circle      size={13} className="text-gray-300 flex-shrink-0"  />}
              {label}
            </button>
          );
        })}
      </div>

      {/* Appraisal + status badges */}
      <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-gray-50">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400">Appraisal:</span>
          {isArive ? (
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
              milestones.appraisal === 'complete'  ? 'bg-green-100 text-green-700' :
              milestones.appraisal === 'scheduled' ? 'bg-amber-100 text-amber-700' :
              milestones.appraisal === 'ordered'   ? 'bg-blue-100 text-blue-700'  :
                                                     'bg-gray-100 text-gray-400'
            }`}>
              {milestones.appraisal ?? 'pending'}
            </span>
          ) : (
            <select
              value={milestones.appraisal ?? 'pending'}
              onChange={(e) => setMilestones((p) => ({ ...p, appraisal: e.target.value as LoanMilestones['appraisal'] }))}
              className="rounded-lg border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium text-brand-navy outline-none"
            >
              <option value="pending">Pending</option>
              <option value="ordered">Ordered</option>
              <option value="scheduled">Scheduled</option>
              <option value="complete">Complete</option>
            </select>
          )}
        </div>
        {milestones.clearToClose && !milestones.funded && (
          <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-700">Clear to Close</span>
        )}
        {milestones.funded && (
          <span className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-bold text-green-700">
            <CheckCircle2 size={11} /> Funded
          </span>
        )}
        {isArive && milestones.ariveLoanStatus && (
          <span className="ml-auto text-[10px] font-bold text-brand-navy uppercase tracking-wide">
            {milestones.ariveLoanStatus.replace(/_/g, ' ')}
          </span>
        )}
      </div>

      {/* ARIVE raw tracker grid */}
      {isArive && milestones.ariveTrackers && milestones.ariveTrackers.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-50">
          <p className="text-[9px] font-bold uppercase tracking-widest text-gray-300 mb-2">ARIVE Trackers</p>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            {milestones.ariveTrackers.map((t) => {
              const s = t.currentTrackerStatus?.status?.toLowerCase() ?? '';
              const done = s === 'completed';
              const active = s !== '' && s !== 'not_started' && !done;
              return (
                <div
                  key={t.name}
                  className={`rounded-lg px-2 py-1.5 text-center ${done ? 'bg-green-50' : active ? 'bg-blue-50' : 'bg-gray-50'}`}
                >
                  <div className={`text-[10px] font-semibold ${done ? 'text-green-700' : active ? 'text-blue-600' : 'text-gray-400'}`}>
                    {t.name.replace(/_/g, ' ')}
                  </div>
                  <div className={`text-[9px] ${done ? 'text-green-500' : active ? 'text-blue-400' : 'text-gray-300'}`}>
                    {t.currentTrackerStatus?.status?.replace(/_/g, ' ') || '—'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function LoanMilestonesSection() {
  const deals           = useMyDeals();
  const withMilestones  = deals.filter((d) => d.loanMilestones != null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Loan Milestones</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          ARIVE-synced files are read-only. External lender files can be updated manually.
        </p>
      </div>
      {withMilestones.length === 0 ? (
        <div className="rounded-xl bg-white px-5 py-10 text-center text-gray-400 shadow-sm">
          No milestone data available
        </div>
      ) : (
        <div className="space-y-4">
          {withMilestones.map((deal) => <MilestonesCard key={deal.id} deal={deal} />)}
        </div>
      )}
    </div>
  );
}

// ─── Checklists ───────────────────────────────────────────────────────────────

const CHECKLIST_STAGES = new Set(['under_contract', 'pre_close', 'closing', 'post_close']);

const ASSIGNEE_OPTIONS: { value: ChecklistAssignee; label: string }[] = [
  { value: 'tc',          label: 'TC'     },
  { value: 'agent',       label: 'Agent'  },
  { value: 'buyer',       label: 'Buyer'  },
  { value: 'seller',      label: 'Seller' },
  { value: 'third_party', label: 'Vendor' },
];

const ASSIGNEE_PILL: Record<ChecklistAssignee, string> = {
  tc:          'bg-amber-100 text-amber-700',
  agent:       'bg-blue-100 text-blue-700',
  buyer:       'bg-green-100 text-green-700',
  seller:      'bg-purple-100 text-purple-700',
  third_party: 'bg-gray-100 text-gray-500',
};

const DEFAULT_CATEGORIES = ['Contract', 'Loan', 'Title', 'Closing'];

function ChecklistCard({ deal }: { deal: Deal }) {
  const { items: dealItems, toggle, assign, setDueDate, addItem, removeItem } = useChecklist(deal.id);
  const { can } = usePermission();
  const canCreate = can(PERMISSIONS.TASK_CREATE);
  const canAssign = can(PERMISSIONS.TASK_ASSIGN_ANY);
  const canEdit   = can(PERMISSIONS.TASK_EDIT);

  const [addingTo, setAddingTo]     = useState<string | null>(null);
  const [newLabel, setNewLabel]     = useState('');
  const [newCategory, setNewCategory] = useState('Contract');

  const items      = dealItems;
  const total      = items.length;
  const done       = items.filter((i) => i.checked).length;
  const pct        = total > 0 ? Math.round((done / total) * 100) : 0;
  const categories = [...new Set([...DEFAULT_CATEGORIES, ...items.map((i) => i.category)])];

  function handleAddItem() {
    if (!newLabel.trim()) return;
    addItem(newLabel.trim(), newCategory);
    setNewLabel('');
    setAddingTo(null);
  }

  return (
    <div className="rounded-xl bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-50">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div>
            <span className="font-bold text-brand-navy">{deal.clientName}</span>
            <span className="ml-2 text-xs text-gray-400">{deal.property.address}</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckSquare size={14} className="text-amber-500" />
            <span className="text-sm font-bold text-brand-navy">{done}/{total}</span>
            <span className="text-xs text-gray-400">({pct}%)</span>
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-gray-100">
          <div className="h-1.5 rounded-full bg-amber-400 transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="divide-y divide-gray-50">
        {categories.map((cat) => {
          const catItems = items.filter((i) => i.category === cat);
          if (catItems.length === 0 && addingTo !== cat) return null;
          const catDone = catItems.filter((i) => i.checked).length;
          return (
            <div key={cat} className="px-5 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-400">{cat}</span>
                <span className="text-[11px] text-gray-300">{catDone}/{catItems.length}</span>
              </div>
              <div className="space-y-1">
                {catItems.map((item) => (
                  <div key={item.id} className={`group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors ${item.checked ? 'opacity-60' : 'hover:bg-gray-50'}`}>
                    <button onClick={() => toggle(item.id)} className="flex-shrink-0 focus:outline-none">
                      {item.checked
                        ? <CheckCircle2 size={16} className="text-green-400" />
                        : <Circle size={16} className="text-gray-300 hover:text-gray-400" />}
                    </button>
                    <span className={`flex-1 text-sm min-w-0 ${item.checked ? 'line-through text-gray-300' : 'text-gray-700'}`}>
                      {item.label}
                    </span>
                    {canAssign && !item.checked ? (
                      <select
                        value={item.assignedTo}
                        onChange={(e) => assign(item.id, e.target.value as ChecklistAssignee)}
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold border-0 outline-none cursor-pointer ${ASSIGNEE_PILL[item.assignedTo]}`}
                      >
                        {ASSIGNEE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : !item.checked ? (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ASSIGNEE_PILL[item.assignedTo]}`}>
                        {ASSIGNEE_OPTIONS.find((o) => o.value === item.assignedTo)?.label}
                      </span>
                    ) : null}
                    {canEdit && !item.checked ? (
                      <input
                        type="date"
                        value={item.dueDate ?? ''}
                        onChange={(e) => setDueDate(item.id, e.target.value || undefined)}
                        className="rounded-lg border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-500 outline-none focus:border-brand-navy/30 w-32"
                      />
                    ) : item.dueDate && !item.checked ? (
                      <span className="text-[11px] text-gray-400">{item.dueDate}</span>
                    ) : null}
                    {item.isCustom && canCreate && (
                      <button
                        onClick={() => removeItem(item.id)}
                        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all flex-shrink-0"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {addingTo === cat ? (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-brand-navy/20 bg-brand-navy/5 px-3 py-2">
                  <input
                    autoFocus type="text" placeholder="Item description..."
                    value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddItem(); if (e.key === 'Escape') setAddingTo(null); }}
                    className="flex-1 bg-transparent text-sm text-brand-navy outline-none placeholder:text-gray-400"
                  />
                  <button onClick={handleAddItem} disabled={!newLabel.trim()} className="rounded-md bg-brand-navy px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40">Add</button>
                  <button onClick={() => { setAddingTo(null); setNewLabel(''); }} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                </div>
              ) : canCreate ? (
                <button
                  onClick={() => { setAddingTo(cat); setNewCategory(cat); }}
                  className="mt-1.5 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-gray-400 hover:text-brand-navy hover:bg-gray-50 transition-colors"
                >
                  <Plus size={12} /> Add item
                </button>
              ) : null}
            </div>
          );
        })}

        {canCreate && (
          <div className="px-5 py-3">
            {addingTo === '__new__' ? (
              <div className="flex items-center gap-2 rounded-lg border border-brand-navy/20 bg-brand-navy/5 px-3 py-2">
                <input autoFocus type="text" placeholder="Category..." value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="w-28 bg-transparent text-sm text-brand-navy outline-none placeholder:text-gray-400" />
                <span className="text-gray-300">/</span>
                <input type="text" placeholder="Item description..." value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleAddItem(); if (e.key === 'Escape') setAddingTo(null); }} className="flex-1 bg-transparent text-sm text-brand-navy outline-none placeholder:text-gray-400" />
                <button onClick={handleAddItem} disabled={!newLabel.trim() || !newCategory.trim()} className="rounded-md bg-brand-navy px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40">Add</button>
                <button onClick={() => { setAddingTo(null); setNewLabel(''); setNewCategory('Contract'); }} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
              </div>
            ) : (
              <button
                onClick={() => { setAddingTo('__new__'); setNewCategory(''); }}
                className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-brand-navy transition-colors"
              >
                <Plus size={12} /> Add custom category &amp; item
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Checklists() {
  const deals        = useMyDeals();
  const eligibleDeals = deals.filter((d) => CHECKLIST_STAGES.has(d.stage));
  const pendingDeals  = deals.filter((d) => !CHECKLIST_STAGES.has(d.stage));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Checklists</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Transaction checklist auto-populates at Under Contract. Add items, reassign, and set due dates per file.
        </p>
      </div>

      {eligibleDeals.length === 0 && pendingDeals.length === 0 && (
        <div className="rounded-xl bg-white px-5 py-10 text-center text-gray-400 shadow-sm">No active files</div>
      )}
      {eligibleDeals.map((deal) => <ChecklistCard key={deal.id} deal={deal} />)}
      {pendingDeals.map((deal) => (
        <div key={deal.id} className="rounded-xl bg-white shadow-sm">
          <div className="px-5 py-4 flex items-center justify-between">
            <div>
              <span className="font-bold text-brand-navy">{deal.clientName}</span>
              <span className="ml-2 text-xs text-gray-400">{deal.property.address}</span>
            </div>
            <div className="flex items-center gap-2 text-gray-300">
              <Lock size={13} />
              <span className="text-xs">Available at Under Contract</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Calendar ────────────────────────────────────────────────────────────────

type CalEvent = {
  id: string;
  date: string;
  title: string;
  sub: string;
  type: 'closing' | 'contingency' | 'task';
};

const CAL_TYPE: Record<CalEvent['type'], { dot: string; label: string }> = {
  closing:     { dot: 'bg-brand-navy', label: 'Closing'     },
  contingency: { dot: 'bg-amber-400',  label: 'Contingency' },
  task:        { dot: 'bg-blue-400',   label: 'Task'        },
};

function CalendarSection() {
  const deals = useMyDeals();
  const allContingencies = useAllContingenciesForDeals(deals.map((d) => d.id));

  const dealMap = Object.fromEntries(deals.map((d) => [d.id, d]));

  const events: CalEvent[] = [];

  deals.forEach((deal) => {
    if (deal.timeline.closingDate) {
      events.push({
        id: `close-${deal.id}`,
        date: deal.timeline.closingDate,
        title: `Closing — ${deal.clientName}`,
        sub: `${deal.property.address}, ${deal.property.city}`,
        type: 'closing',
      });
    }
  });

  allContingencies
    .filter((c) => c.status === 'active' && c.deadline)
    .forEach((c) => {
      const deal = dealMap[c.dealId];
      if (!deal) return;
      events.push({
        id: `cont-${c.id}`,
        date: c.deadline!,
        title: `${c.label} — ${deal.clientName}`,
        sub: deal.property.address,
        type: 'contingency',
      });
    });

  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const overdue = events.filter((e) => daysUntil(e.date) < 0);
  const today   = events.filter((e) => daysUntil(e.date) === 0);
  const week1   = events.filter((e) => daysUntil(e.date) > 0  && daysUntil(e.date) <= 7);
  const week2   = events.filter((e) => daysUntil(e.date) > 7  && daysUntil(e.date) <= 14);
  const month   = events.filter((e) => daysUntil(e.date) > 14 && daysUntil(e.date) <= 30);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Calendar</h1>
        <p className="text-sm text-gray-400 mt-0.5">Closings, contingency deadlines, and TC task due dates</p>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        {(Object.entries(CAL_TYPE) as [CalEvent['type'], { dot: string; label: string }][]).map(([, { dot, label }]) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
            <span className="text-xs text-gray-500">{label}</span>
          </div>
        ))}
      </div>

      {events.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white py-16 shadow-sm text-center">
          <CalendarDays size={32} className="mx-auto mb-2 text-gray-300" />
          <p className="text-sm text-gray-400">No upcoming events</p>
        </div>
      ) : (
        <div className="space-y-6">
          <CalEventGroup title="Past / Overdue" items={overdue} accent="text-red-600"   />
          <CalEventGroup title="Today"          items={today}   accent="text-amber-600" />
          <CalEventGroup title="Next 7 Days"    items={week1}   accent="text-amber-500" />
          <CalEventGroup title="Next 2 Weeks"   items={week2}   accent="text-blue-500"  />
          <CalEventGroup title="This Month"     items={month}   accent="text-gray-400"  />
        </div>
      )}
    </div>
  );
}

// ─── Module-scope helpers for CalendarSection (hoisted to satisfy
// react-hooks/static-components) ─────────────────────────────────────────────

function CalEventRow({ event }: { event: CalEvent }) {
  const days    = daysUntil(event.date);
  const isPast  = days < 0;
  const isToday = days === 0;
  const t = CAL_TYPE[event.type];
  return (
    <div className={`flex items-center gap-3 rounded-xl px-4 py-3 ${
      isPast  ? 'bg-red-50 border border-red-100' :
      isToday ? 'bg-amber-50 border border-amber-100' :
                'bg-white border border-gray-100'
    }`}>
      <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${t.dot}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold truncate ${isPast ? 'text-red-800' : 'text-brand-navy'}`}>{event.title}</p>
        <p className="text-xs text-gray-400 truncate">{event.sub}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <div className={`text-xs font-bold ${isPast ? 'text-red-600' : isToday ? 'text-amber-600' : 'text-gray-400'}`}>
          {isPast ? `${Math.abs(days)}d ago` : isToday ? 'Today' : `${days}d`}
        </div>
        <div className="text-[10px] text-gray-300">{event.date}</div>
      </div>
      <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase bg-gray-100 text-gray-500 flex-shrink-0">
        {t.label}
      </span>
    </div>
  );
}

function CalEventGroup({ title, items, accent }: { title: string; items: CalEvent[]; accent: string }) {
  if (items.length === 0) return null;
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className={`text-xs font-bold uppercase tracking-wider ${accent}`}>{title}</h2>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500">{items.length}</span>
      </div>
      <div className="space-y-2">{items.map((e) => <CalEventRow key={e.id} event={e} />)}</div>
    </section>
  );
}

// ─── Contacts ────────────────────────────────────────────────────────────────

type ContactEntry = {
  role: string;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
};

function ContactCard({ contact }: { contact: ContactEntry }) {
  const [copiedEmail, setCopiedEmail] = useState(false);

  function copyEmail() {
    if (!contact.email) return;
    navigator.clipboard.writeText(contact.email).catch(() => {});
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gray-100">
        <User size={15} className="text-gray-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-brand-navy truncate">{contact.name}</div>
        <div className="text-xs text-gray-400 truncate">
          {contact.role}{contact.company ? ` · ${contact.company}` : ''}
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {contact.phone && (
          <a
            href={`tel:${contact.phone.replace(/\D/g, '')}`}
            className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-brand-navy transition-colors"
          >
            <Phone size={11} /> Call
          </a>
        )}
        {contact.email && (
          <button
            onClick={copyEmail}
            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              copiedEmail
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-brand-navy'
            }`}
          >
            {copiedEmail ? <><CheckCircle2 size={11} /> Copied</> : <><Copy size={11} /> Email</>}
          </button>
        )}
      </div>
    </div>
  );
}

function ContactsSection() {
  const deals = useMyDeals();

  function buildContacts(deal: Deal): ContactEntry[] {
    const contacts: ContactEntry[] = [];

    if (deal.agentName) contacts.push({ role: 'Agent', name: deal.agentName, email: deal.agentEmail, phone: deal.agentPhone ?? undefined });

    const lender = deal.vendors?.lender;
    if (lender) contacts.push({ role: 'Loan Officer', name: lender.contactName ?? 'Loan Officer', company: lender.company, phone: lender.phone, email: lender.email });

    const title = deal.vendors?.titleCompany;
    if (title) contacts.push({ role: 'Title Officer', name: title.contactName ?? 'Title Company', company: title.company, phone: title.phone, email: title.email });

    const inspector = deal.vendors?.inspector;
    if (inspector) contacts.push({ role: 'Inspector', name: inspector.contactName ?? 'Inspector', company: inspector.company, phone: inspector.phone, email: inspector.email });

    const insurance = deal.vendors?.insurance;
    if (insurance) contacts.push({ role: 'Insurance Agent', name: insurance.contactName ?? 'Insurance', company: insurance.company, phone: insurance.phone, email: insurance.email });

    return contacts;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Contacts</h1>
        <p className="text-sm text-gray-400 mt-0.5">All parties across your active files — click to call or copy email</p>
      </div>

      {deals.map((deal) => {
        const contacts = buildContacts(deal);
        return (
          <section key={deal.id}>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <h2 className="text-sm font-bold text-brand-navy">{deal.clientName}</h2>
              <span className="text-xs text-gray-400">{deal.property.address}</span>
              <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${HEALTH_BADGE[deal.health]}`}>
                {STAGE_LABELS[deal.stage]}
              </span>
            </div>
            <div className="rounded-xl bg-white shadow-sm overflow-hidden divide-y divide-gray-50">
              {contacts.map((c, i) => <ContactCard key={i} contact={c} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ─── Main TCDashboard ─────────────────────────────────────────────────────────

// ─── Overview (My Transactions + Contingencies + Deadlines combined) ─────────

type OverviewView = 'transactions' | 'contingencies' | 'deadlines';

const OVERVIEW_OPTIONS: { value: OverviewView; label: string }[] = [
  { value: 'transactions',  label: 'My Transactions'  },
  { value: 'contingencies', label: 'Contingencies'    },
  { value: 'deadlines',     label: 'Deadlines'        },
];

function Overview() {
  const [view, setView] = useState<OverviewView>('transactions');
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const current = OVERVIEW_OPTIONS.find((o) => o.value === view)!;

  return (
    <div className="space-y-6">
      {/* View switcher */}
      <div ref={ref} className="relative inline-block">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-brand-navy shadow-sm hover:bg-gray-50 transition-colors"
        >
          {current.label}
          <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="absolute left-0 top-full mt-1.5 z-20 w-48 rounded-xl bg-white shadow-xl border border-gray-100 overflow-hidden">
            {OVERVIEW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => { setView(opt.value); setOpen(false); }}
                className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
                  opt.value === view
                    ? 'bg-brand-navy text-white font-semibold'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Active view */}
      {view === 'transactions'  && <MyTransactions />}
      {view === 'contingencies' && <ContingenciesSection />}
      {view === 'deadlines'     && <Deadlines />}
    </div>
  );
}

// ─── Main TCDashboard ─────────────────────────────────────────────────────────

export default function TCDashboard() {
  const { section } = useParams<{ section?: string }>();

  switch (section) {
    case 'documents':   return <Documents />;
    case 'disclosures': return <LoanMilestonesSection />;
    case 'checklists':  return <Checklists />;
    case 'calendar':    return <CalendarSection />;
    case 'messages':    return <ContactsSection />;
    default:            return <Overview />;
  }
}
