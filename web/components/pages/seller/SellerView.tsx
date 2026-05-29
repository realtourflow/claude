"use client";

import { useState } from 'react';
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/authStore";
import { Deal, DealStage } from "@/lib/data/mockDeals";
import { Task } from "@/lib/data/mockTasks";
import ClientNotifications from "@/components/ClientNotifications";
import { useDealStageStore } from "@/lib/store/dealStageStore";
import { useMyDeals } from "@/hooks/useMyDeals";
import { useTasks } from "@/hooks/useTasks";
import { useMessages, postMessage } from "@/hooks/useMessages";
import { useShowingAvailability, DAYS_OF_WEEK, ShowingSlot, DayOfWeek } from "@/hooks/useShowingAvailability";
import { useOffers } from "@/hooks/useOffers";
import { useNetSheet, recalcLines, calcNetProceeds } from "@/hooks/useNetSheet";
import {
  CheckCircle2, Circle, AlertCircle, Loader2, XCircle,
  MapPin, Calendar, MessageSquare, FileText,
  Phone, Mail, Home, Star,
  TrendingUp, Clock, DollarSign, Eye, Wrench, Send,
} from 'lucide-react';
import VendorDirectory from "@/components/VendorDirectory";

// ─── Constants ────────────────────────────────────────────────────────────────

const SELLER_STAGE_LABELS: Record<DealStage, string> = {
  intake:         'Getting Started',
  active_search:  'Listing Prep',
  offer_active:   'Listed & Active',
  under_contract: 'Under Contract',
  pre_close:      'Pre-Close',
  closing:        'Closing Day',
  post_close:     'Sold!',
};

const STAGE_ORDER: DealStage[] = [
  'intake', 'active_search', 'offer_active', 'under_contract', 'pre_close', 'closing', 'post_close',
];

const TASK_STATUS_ICON: Record<string, React.ReactNode> = {
  completed:   <CheckCircle2 size={18} className="text-green-500 flex-shrink-0" />,
  in_progress: <Loader2 size={18} className="text-blue-500 flex-shrink-0 animate-spin" />,
  overdue:     <AlertCircle size={18} className="text-red-500 flex-shrink-0" />,
  pending:     <Circle size={18} className="text-gray-300 flex-shrink-0" />,
  blocked:     <AlertCircle size={18} className="text-orange-400 flex-shrink-0" />,
};

// ─── Shared: Task card ────────────────────────────────────────────────────────

function TaskCard({ task, onComplete }: { task: Task; onComplete?: (id: string) => void }) {
  const isOverdue = task.status === 'overdue';
  const isDone    = task.status === 'completed';
  return (
    <button
      onClick={() => !isDone && onComplete?.(task.id)}
      className={`w-full text-left flex items-start gap-3 rounded-xl p-4 transition-all ${
        isOverdue ? 'bg-red-50 border border-red-100' :
        isDone    ? 'bg-gray-50 opacity-60' :
        'bg-white border border-gray-100 hover:border-green-200 hover:bg-green-50/40 active:scale-[0.99]'
      }`}
    >
      {isDone
        ? <CheckCircle2 size={18} className="text-green-500 flex-shrink-0" />
        : TASK_STATUS_ICON[task.status]}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${isDone ? 'line-through text-gray-400' : 'text-brand-navy'}`}>
          {task.title}
        </p>
        {task.description && !isDone && (
          <p className="mt-0.5 text-xs text-gray-400 leading-relaxed">{task.description}</p>
        )}
        {task.dueDate && !isDone && (
          <p className={`mt-1 text-[11px] font-medium ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}>
            {isOverdue ? 'Overdue — ' : 'Due '}{task.dueDate}
          </p>
        )}
        {isDone && <p className="mt-0.5 text-[11px] text-green-600">Marked complete</p>}
      </div>
    </button>
  );
}

// ─── Shared: Tab bar ──────────────────────────────────────────────────────────

type Tab = 'tasks' | 'messages' | 'documents';

function TabBar({ active, onChange, taskCount, msgCount }: {
  active: Tab; onChange: (t: Tab) => void; taskCount: number; msgCount: number;
}) {
  const tabs: { id: Tab; label: string; icon: React.ElementType; count?: number }[] = [
    { id: 'tasks',     label: 'Tasks',     icon: CheckCircle2, count: taskCount },
    { id: 'messages',  label: 'Messages',  icon: MessageSquare, count: msgCount },
    { id: 'documents', label: 'Documents', icon: FileText },
  ];
  return (
    <div className="flex gap-1 rounded-xl bg-white p-1 shadow-sm">
      {tabs.map(({ id, label, icon: Icon, count }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={[
            'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-semibold transition-colors',
            active === id ? 'bg-brand-navy text-white shadow-sm' : 'text-gray-400 hover:bg-gray-50',
          ].join(' ')}
        >
          <Icon size={14} />
          {label}
          {count !== undefined && count > 0 && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
              active === id ? 'bg-white/20 text-white' : 'bg-brand-navy/10 text-brand-navy'
            }`}>{count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Shared: Messages tab ─────────────────────────────────────────────────────

function MessagesTab({ dealId }: { dealId: string }) {
  const { messages, loading, refresh } = useMessages(dealId, 'client_thread');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      await postMessage(dealId, 'client_thread', draft.trim());
      setDraft('');
      await refresh();
    } catch {}
    setSending(false);
  }

  return (
    <div className="space-y-3">
      {!loading && messages.length === 0 && (
        <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
          <MessageSquare size={28} className="mx-auto mb-2 text-gray-200" />
          <p className="text-sm text-gray-400">No messages yet</p>
        </div>
      )}
      {messages.map((msg) => {
        const isAgent = msg.senderRole === 'agent';
        return (
          <div key={msg.id} className={`flex gap-2.5 ${isAgent ? '' : 'flex-row-reverse'}`}>
            <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-white text-xs font-bold ${
              isAgent ? 'bg-brand-navy' : 'bg-purple-500'
            }`}>
              {msg.senderName.charAt(0)}
            </div>
            <div className={`max-w-[78%] flex flex-col gap-1 ${isAgent ? 'items-start' : 'items-end'}`}>
              <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                isAgent ? 'bg-gray-100 text-gray-800 rounded-tl-sm' : 'bg-purple-600 text-white rounded-tr-sm'
              }`}>{msg.content}</div>
              <span className="text-[10px] text-gray-300">
                {new Date(msg.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
          </div>
        );
      })}
      <div className="pt-1 flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Message your agent…"
          className="flex-1 rounded-full border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10"
        />
        <button
          onClick={handleSend}
          disabled={!draft.trim() || sending}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-brand-navy text-white hover:bg-brand-navy/80 transition-colors disabled:opacity-50"
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}

// ─── Shared: Documents tab ────────────────────────────────────────────────────

const SELLER_DOCS = [
  { id: 'd1', name: 'Listing Agreement',    status: 'signed',             date: '2026-02-01' },
  { id: 'd2', name: 'Seller Disclosures',   status: 'pending_signature',  date: '2026-02-10' },
  { id: 'd3', name: 'Purchase Agreement',   status: 'signed',             date: '2026-02-14' },
  { id: 'd4', name: 'Repair Addendum',      status: 'pending_review',     date: '2026-02-15' },
];
const DOC_STATUS: Record<string, { label: string; style: string }> = {
  signed:            { label: 'Signed',        style: 'bg-green-100 text-green-700' },
  pending_review:    { label: 'Review needed', style: 'bg-amber-100 text-amber-700' },
  pending_signature: { label: 'Sign now',      style: 'bg-red-100 text-red-700' },
};

function DocumentsTab() {
  return (
    <div className="space-y-2">
      {SELLER_DOCS.map((doc) => {
        const s = DOC_STATUS[doc.status];
        return (
          <div key={doc.id} className="flex items-center gap-3 rounded-xl bg-white border border-gray-100 px-4 py-3">
            <FileText size={16} className="flex-shrink-0 text-gray-300" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-brand-navy truncate">{doc.name}</p>
              <p className="text-[11px] text-gray-400">{doc.date}</p>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${s.style}`}>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Shared: Agent card ───────────────────────────────────────────────────────

function AgentCard({ agentName, agentEmail, agentPhone }: {
  agentName: string;
  agentEmail: string;
  agentPhone: string | null;
}) {
  const initials = agentName.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="rounded-2xl bg-brand-navy p-5 text-white">
      <p className="mb-3 text-xs font-bold uppercase tracking-widest text-white/50">Your Agent</p>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-gold/20 ring-2 ring-brand-gold/40 text-brand-gold font-bold text-sm flex-shrink-0">
          {initials}
        </div>
        <div>
          <p className="font-bold text-white">{agentName}</p>
          <p className="text-xs text-white/60">RealTour Flow Agent</p>
        </div>
      </div>
      <div className="space-y-2">
        {agentPhone && (
          <a href={`tel:${agentPhone}`} className="flex items-center gap-2.5 rounded-lg bg-white/10 px-3 py-2 text-sm text-white/80 hover:bg-white/20 transition-colors">
            <Phone size={14} /> {agentPhone}
          </a>
        )}
        <a href={`mailto:${agentEmail}`} className="flex items-center gap-2.5 rounded-lg bg-white/10 px-3 py-2 text-sm text-white/80 hover:bg-white/20 transition-colors">
          <Mail size={14} /> {agentEmail}
        </a>
      </div>
    </div>
  );
}

// ─── Journey tracker ──────────────────────────────────────────────────────────

function JourneyTracker({ deal }: { deal: Deal }) {
  const isFallenThrough = deal.status === 'fallen_through';
  const currentIdx = STAGE_ORDER.indexOf(
    isFallenThrough ? (deal.fellFromStage ?? deal.stage) : deal.stage
  );

  return (
    <div className="rounded-2xl bg-white shadow-sm p-5">
      <h3 className="mb-4 text-xs font-bold uppercase tracking-widest text-gray-400">Your Selling Journey</h3>
      <div className="space-y-2">
        {STAGE_ORDER.map((stage, i) => {
          const isPast    = i < currentIdx;
          const isCurrent = i === currentIdx;
          const isFellHere = isFallenThrough && isCurrent;
          return (
            <div key={stage} className="flex items-center gap-3">
              <div className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${
                isFellHere ? 'bg-red-400' :
                isPast     ? 'bg-purple-400' :
                isCurrent  ? 'bg-brand-gold ring-2 ring-brand-gold/30 ring-offset-1' :
                             'bg-gray-100'
              }`}>
                {isFellHere  && <XCircle size={14} className="text-white" />}
                {isPast      && <CheckCircle2 size={14} className="text-white" />}
                {isCurrent && !isFallenThrough && <div className="h-2 w-2 rounded-full bg-brand-navy" />}
              </div>
              <span className={`text-sm ${
                isFellHere ? 'text-red-500 font-semibold' :
                isPast     ? 'text-purple-600 font-medium' :
                isCurrent  ? 'font-bold text-brand-navy' :
                             'text-gray-300'
              }`}>
                {SELLER_STAGE_LABELS[stage]}
              </span>
              {isCurrent && !isFallenThrough && (
                <span className="ml-auto rounded-full bg-brand-gold/20 px-2 py-0.5 text-[10px] font-bold text-brand-navy uppercase tracking-wide">Now</span>
              )}
              {isFellHere && (
                <span className="ml-auto rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-600 uppercase tracking-wide">Fell out</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Stage-specific cards ─────────────────────────────────────────────────────

function IntakeCard({ firstName }: { firstName: string }) {
  const router = useRouter();
  return (
    <div className="rounded-2xl bg-gradient-to-br from-purple-700 to-indigo-800 p-5 text-white">
      <p className="text-xs font-bold uppercase tracking-widest text-white/50 mb-1">Getting Started</p>
      <p className="text-xl font-black mb-2">Welcome, {firstName}!</p>
      <p className="text-sm text-white/70 mb-5 leading-relaxed">
        Your agent has set up your home selling portal. Answer a few quick questions so we can personalize your experience — takes about 3 minutes.
      </p>
      <div className="space-y-2 mb-5">
        {['🏠  About your property', '📋  Your selling timeline', '📱  Your personal deal portal'].map((item) => (
          <div key={item} className="flex items-center gap-2 text-sm text-white/75">{item}</div>
        ))}
      </div>
      <button
        onClick={() => router.push('/onboard/seller')}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-gold py-3.5 text-sm font-bold text-brand-navy hover:bg-brand-gold/90 transition-colors"
      >
        Begin my onboarding →
      </button>
    </div>
  );
}

function ListingPrepCard() {
  const DEFAULT_ITEMS = [
    'Deep clean / declutter',
    'Minor repairs completed',
    'Professional photos scheduled',
    'Listing copy approved',
    'Disclosures package complete',
    'Lockbox installed',
  ];
  const [done, setDone] = useState<Set<number>>(new Set([0, 1]));

  function toggle(i: number) {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  const pct = Math.round((done.size / DEFAULT_ITEMS.length) * 100);

  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
      <div className="bg-indigo-50 border-b border-indigo-100 px-5 py-3 flex items-center justify-between">
        <span className="text-sm font-bold text-indigo-800">Listing Prep Checklist</span>
        <span className="text-sm font-black text-indigo-700">{done.size}/{DEFAULT_ITEMS.length} done</span>
      </div>
      <div className="h-1.5 bg-gray-100">
        <div className="h-full bg-indigo-400 transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
      <div className="p-5 space-y-1">
        {DEFAULT_ITEMS.map((item, i) => {
          const isDone = done.has(i);
          return (
            <button
              key={i}
              onClick={() => toggle(i)}
              className="w-full flex items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
            >
              <div className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-all ${
                isDone ? 'bg-green-400' : 'border-2 border-gray-200 hover:border-gray-300'
              }`}>
                {isDone && <CheckCircle2 size={12} className="text-white" />}
              </div>
              <span className={`text-sm transition-all ${isDone ? 'line-through text-gray-300' : 'text-gray-700'}`}>
                {item}
              </span>
            </button>
          );
        })}
        {done.size === DEFAULT_ITEMS.length && (
          <div className="mt-3 rounded-xl bg-green-50 border border-green-100 px-4 py-3 text-center">
            <p className="text-sm font-bold text-green-700">🎉 All prep items complete!</p>
            <p className="text-xs text-green-600 mt-0.5">Your agent will review and schedule your listing date.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ShowingAvailabilityModal ─────────────────────────────────────────────────

function ShowingAvailabilityModal({ dealId, onClose }: { dealId: string; onClose: () => void }) {
  const { saveSlots } = useShowingAvailability(dealId);
  const [enabled, setEnabled] = useState<Set<DayOfWeek>>(new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']));
  const [times, setTimes] = useState<Record<DayOfWeek, { from: string; to: string }>>({
    Mon: { from: '09:00', to: '18:00' }, Tue: { from: '09:00', to: '18:00' },
    Wed: { from: '09:00', to: '18:00' }, Thu: { from: '09:00', to: '18:00' },
    Fri: { from: '09:00', to: '18:00' }, Sat: { from: '10:00', to: '15:00' },
    Sun: { from: '12:00', to: '15:00' },
  });

  const TIME_OPTIONS = [
    '07:00','08:00','09:00','10:00','11:00','12:00',
    '13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00',
  ];
  function fmt(t: string) {
    const [h] = t.split(':');
    const n = parseInt(h);
    return n === 12 ? '12pm' : n > 12 ? `${n - 12}pm` : `${n}am`;
  }

  function toggleDay(day: DayOfWeek) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day); else next.add(day);
      return next;
    });
  }

  async function save() {
    const slots: ShowingSlot[] = DAYS_OF_WEEK
      .filter((d) => enabled.has(d))
      .map((d) => ({ day: d, from: times[d].from, to: times[d].to }));
    await saveSlots(slots).catch(() => {});
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-0">
      <div className="w-full max-w-lg rounded-t-2xl bg-white shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Showings</p>
          <h3 className="text-base font-black text-brand-navy">Set your showing availability</h3>
          <p className="text-xs text-gray-400 mt-0.5">Let your agent know when buyers can schedule tours of your home.</p>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {DAYS_OF_WEEK.map((day) => {
            const on = enabled.has(day);
            return (
              <div key={day} className={`rounded-xl border transition-all ${on ? 'border-brand-navy/20 bg-brand-navy/5' : 'border-gray-100 bg-gray-50'}`}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    onClick={() => toggleDay(day)}
                    className={`flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${on ? 'bg-brand-navy' : 'bg-gray-200'}`}
                  >
                    <span className={`ml-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : ''}`} />
                  </button>
                  <span className={`flex-1 text-sm font-semibold ${on ? 'text-brand-navy' : 'text-gray-400'}`}>{day}</span>
                  {on && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <select
                        value={times[day].from}
                        onChange={(e) => setTimes((p) => ({ ...p, [day]: { ...p[day], from: e.target.value } }))}
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-navy outline-none"
                      >
                        {TIME_OPTIONS.map((t) => <option key={t} value={t}>{fmt(t)}</option>)}
                      </select>
                      <span>to</span>
                      <select
                        value={times[day].to}
                        onChange={(e) => setTimes((p) => ({ ...p, [day]: { ...p[day], to: e.target.value } }))}
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-navy outline-none"
                      >
                        {TIME_OPTIONS.map((t) => <option key={t} value={t}>{fmt(t)}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t border-gray-100 px-5 py-4 space-y-2">
          <button
            onClick={save}
            disabled={enabled.size === 0}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-navy py-3.5 text-sm font-bold text-white disabled:opacity-40 hover:bg-brand-navy/90 transition-all"
          >
            Save my availability
          </button>
          <button onClick={onClose} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 py-1 transition-colors">
            I&apos;ll do this later
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ListingActiveCard ────────────────────────────────────────────────────────

function ListingActiveCard({ deal }: { deal: Deal }) {
  const [showAvailModal, setShowAvailModal] = useState(false);
  const { slots: availability } = useShowingAvailability(deal.id);
  const { offers } = useOffers(deal.id);
  const daysOnMarket = deal.timeline.daysInStage ?? 0;

  function fmt(t: string) {
    const [h] = t.split(':');
    const n = parseInt(h);
    return n === 12 ? '12pm' : n > 12 ? `${n - 12}pm` : `${n}am`;
  }

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
        <div className="bg-green-50 border-b border-green-100 px-5 py-3 flex items-center gap-2">
          <TrendingUp size={15} className="text-green-600" />
          <span className="text-sm font-bold text-green-800">You&apos;re live on the market</span>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { icon: Clock,      label: 'Days Listed', value: String(daysOnMarket) },
              { icon: Eye,        label: 'Showings',    value: '7' },
              { icon: TrendingUp, label: 'Online Views', value: '142' },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="rounded-xl bg-gray-50 px-3 py-3 text-center">
                <Icon size={14} className="text-gray-400 mx-auto mb-1" />
                <p className="text-xl font-black text-brand-navy leading-none">{value}</p>
                <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{label}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3">
            <p className="text-xs font-semibold text-amber-800 mb-1">Latest showing feedback</p>
            <p className="text-xs text-amber-600 leading-relaxed italic">
              &quot;Great layout, loved the kitchen. Buyers want to see it again this weekend.&quot;
            </p>
          </div>
        </div>
      </div>

      {/* Showing availability */}
      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-brand-navy" />
            <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Showing Availability</span>
          </div>
          <button
            onClick={() => setShowAvailModal(true)}
            className="text-xs font-semibold text-brand-navy hover:text-brand-navy/70 transition-colors"
          >
            {availability.length > 0 ? 'Edit' : 'Set availability'}
          </button>
        </div>
        {availability.length === 0 ? (
          <div className="px-5 py-5 text-center">
            <p className="text-sm text-gray-400">No availability set yet.</p>
            <button
              onClick={() => setShowAvailModal(true)}
              className="mt-2 rounded-lg bg-brand-navy px-4 py-2 text-xs font-bold text-white hover:bg-brand-navy/80 transition-colors"
            >
              Set my availability
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {availability.map((slot) => (
              <div key={slot.day} className="flex items-center justify-between px-5 py-2.5">
                <span className="text-sm font-semibold text-brand-navy w-10">{slot.day}</span>
                <span className="text-sm text-gray-500">{fmt(slot.from)} – {fmt(slot.to)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Offers */}
      {offers.length > 0 && (
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100">
            <span className="text-xs font-bold uppercase tracking-widest text-gray-500">
              Offers Received ({offers.length})
            </span>
          </div>
          <div className="divide-y divide-gray-50">
            {offers.map((offer) => (
              <div key={offer.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <p className="text-lg font-black text-brand-navy">${offer.offerPrice.toLocaleString()}</p>
                    <p className="text-xs text-gray-400">{offer.buyerName} · Close {offer.closeDate}</p>
                  </div>
                </div>
                {offer.contingencies.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {offer.contingencies.map((c) => (
                      <span key={c} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">{c}</span>
                    ))}
                  </div>
                )}
                {offer.agentNotes && (
                  <div className="rounded-lg bg-brand-navy/5 border border-brand-navy/10 px-3 py-2">
                    <p className="text-[11px] font-semibold text-brand-navy/60 uppercase tracking-wide mb-0.5">Agent Notes</p>
                    <p className="text-xs text-brand-navy leading-relaxed">{offer.agentNotes}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showAvailModal && (
        <ShowingAvailabilityModal dealId={deal.id} onClose={() => setShowAvailModal(false)} />
      )}
    </div>
  );
}

// ─── UnderContractCard ────────────────────────────────────────────────────────

function UnderContractCard({ deal }: { deal: Deal }) {
  const hasRepairRequest = deal.flags.includes('repair_request');
  const { buyerStatusByDeal } = useDealStageStore();
  // Net sheet shown inline when agent marks it ready
  const buyerStatus = buyerStatusByDeal[deal.id];

  const BUYER_STATUS_STEPS = [
    'Inspection scheduled',
    'Inspection complete',
    'Appraisal ordered',
    'Appraisal complete',
    'Financing in review',
    'Financing approved',
    'Clear to close',
  ];

  const statusIdx = buyerStatus ? BUYER_STATUS_STEPS.indexOf(buyerStatus) : -1;

  return (
    <div className="space-y-3">
      {hasRepairRequest && (
        <div className="flex items-start gap-3 rounded-xl bg-orange-50 border border-orange-200 px-4 py-3">
          <Wrench size={18} className="text-orange-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-orange-800">Buyer submitted a repair request</p>
            <p className="text-xs text-orange-600 mt-0.5 leading-relaxed">
              Your agent is reviewing it. You&apos;ll need to respond — accept, reject, or counter — within the deadline. They&apos;ll be in touch shortly.
            </p>
          </div>
        </div>
      )}

      {deal.timeline.daysToClose !== undefined && (
        <div className="flex items-center justify-between rounded-xl bg-white border border-gray-100 shadow-sm px-5 py-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <Calendar size={11} />
            <span>Target closing: {deal.timeline.closingDate}</span>
          </div>
          <div className="text-right">
            <span className="text-xl font-black text-brand-navy">{deal.timeline.daysToClose}</span>
            <span className="ml-1 text-xs text-gray-400">days to close</span>
          </div>
        </div>
      )}

      {/* Buyer status */}
      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100">
          <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Buyer&apos;s Progress</span>
        </div>
        {!buyerStatus ? (
          <div className="px-5 py-4 text-center">
            <p className="text-sm text-gray-400">Your agent will update the buyer&apos;s status here.</p>
          </div>
        ) : (
          <div className="p-5 space-y-2">
            {BUYER_STATUS_STEPS.map((step, i) => {
              const isPast = i < statusIdx;
              const isCurrent = i === statusIdx;
              return (
                <div key={step} className="flex items-center gap-3">
                  <div className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${
                    isCurrent ? 'bg-brand-navy' : isPast ? 'bg-green-400' : 'border-2 border-gray-200'
                  }`}>
                    {isPast && <CheckCircle2 size={11} className="text-white" />}
                    {isCurrent && <div className="h-2 w-2 rounded-full bg-white" />}
                  </div>
                  <span className={`text-sm ${
                    isCurrent ? 'font-bold text-brand-navy' : isPast ? 'text-green-600 line-through' : 'text-gray-300'
                  }`}>{step}</span>
                  {isCurrent && (
                    <span className="ml-auto rounded-full bg-brand-gold/20 px-2 py-0.5 text-[10px] font-bold text-brand-navy">
                      Current
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <NetSheetReadOnlyCard dealId={deal.id} compact />
    </div>
  );
}

function PreCloseCard({ deal }: { deal: Deal }) {
  const items = [
    { label: 'Complete agreed repairs',           done: false },
    { label: 'Remove all personal belongings',    done: false },
    { label: 'Schedule final walkthrough access', done: false },
    { label: 'Confirm possession date',           done: false },
    { label: 'Utilities transfer arranged',       done: false },
  ];
  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
        <div className="bg-blue-50 border-b border-blue-100 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Star size={15} className="text-blue-600" />
            <span className="text-sm font-bold text-blue-800">Almost at the finish line</span>
          </div>
          {deal.timeline.daysToClose !== undefined && (
            <span className="text-sm font-black text-blue-700">{deal.timeline.daysToClose} days</span>
          )}
        </div>
        <div className="p-5 space-y-2.5">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${
                item.done ? 'bg-green-400' : 'border-2 border-gray-200'
              }`}>
                {item.done && <CheckCircle2 size={12} className="text-white" />}
              </div>
              <span className={`text-sm ${item.done ? 'line-through text-gray-300' : 'text-gray-700'}`}>
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>
      <NetSheetReadOnlyCard dealId={deal.id} compact />
    </div>
  );
}

function ClosingCard({ deal }: { deal: Deal }) {
  const checklist = [
    'Government-issued photo ID',
    'All keys, garage openers & access codes',
    'Any manuals / warranty documents for the home',
    'Forward your mail before you leave',
  ];
  return (
    <div className="rounded-2xl overflow-hidden">
      <div className="bg-brand-gold px-5 py-4">
        <p className="text-xs font-bold uppercase tracking-widest text-brand-navy/60">Closing Day</p>
        <p className="text-xl font-black text-brand-navy mt-0.5">Today&apos;s the day!</p>
        <p className="text-sm text-brand-navy/70 mt-1">
          Sale price: ${deal.property.price.toLocaleString()}
        </p>
      </div>
      <div className="bg-white border border-brand-gold/30 rounded-b-2xl p-5 space-y-2.5">
        {checklist.map((item, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand-gold/20">
              <span className="text-[10px] font-bold text-brand-navy">{i + 1}</span>
            </div>
            <span className="text-sm text-gray-700">{item}</span>
          </div>
        ))}
        <div className="pt-2 border-t border-gray-100 mt-2">
          <p className="text-xs text-gray-400 leading-relaxed">
            Your agent will be at closing with you. Net proceeds will be wired to you within 1–2 business days.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── PostCloseCard ────────────────────────────────────────────────────────────

function NetSheetReadOnlyCard({ dealId, compact }: { dealId: string; compact?: boolean }) {
  const { sheet, loading, notReady } = useNetSheet(dealId);
  if (loading) return null;
  if (notReady || !sheet || sheet.status !== 'ready') return null;
  const lines = recalcLines(sheet.lines, sheet.salePrice, sheet.annualTaxes, sheet.closingDate);
  const netProceeds = calcNetProceeds(lines, sheet.salePrice);
  const enabledLines = lines.filter((l) => l.enabled && l.amount > 0);

  if (compact) {
    return (
      <div className="rounded-xl bg-white border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Estimated Net Proceeds</span>
          <span className="text-sm font-black text-green-600">${netProceeds.toLocaleString()}</span>
        </div>
        <div className="px-4 py-2 text-[11px] text-gray-400">
          Your agent has shared your net sheet. See full breakdown on your post-close page.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100">
        <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Estimated Net Proceeds</span>
      </div>
      <div className="px-5 py-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Sale Price</span>
          <span className="text-sm font-semibold text-brand-navy">+${sheet.salePrice.toLocaleString()}</span>
        </div>
        {enabledLines.map((l) => (
          <div key={l.id} className="flex items-center justify-between">
            <span className="text-sm text-gray-600">{l.label}{l.isPct && l.pct ? ` (${l.pct}%)` : ''}</span>
            <span className="text-sm font-semibold text-gray-500">-${l.amount.toLocaleString()}</span>
          </div>
        ))}
        <div className="border-t border-gray-100 pt-2.5 flex items-center justify-between">
          <span className="text-base font-black text-brand-navy">Estimated Net</span>
          <span className={`text-2xl font-black ${netProceeds >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            ${netProceeds.toLocaleString()}
          </span>
        </div>
        <p className="text-[10px] text-gray-300 leading-relaxed">
          Estimate only — actual figures provided by title at closing.
        </p>
      </div>
    </div>
  );
}

function PostCloseCard({ deal, firstName }: { deal: Deal; firstName: string }) {
  const [showReferral, setShowReferral] = useState(false);

  return (
    <div className="space-y-3">
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-700 p-5 text-white">
        <div className="flex items-center gap-2 mb-2">
          <DollarSign size={20} className="text-white" />
          <p className="text-xs font-bold uppercase tracking-widest text-white/60">Congratulations!</p>
        </div>
        <p className="text-xl font-black">{firstName}, you sold it!</p>
        <p className="text-sm text-white/70 mt-1">{deal.property.address}</p>
        <div className="mt-3 rounded-xl bg-white/10 px-4 py-3">
          <p className="text-xs text-white/60">Final sale price</p>
          <p className="text-2xl font-black">${deal.property.price.toLocaleString()}</p>
        </div>
      </div>

      {/* Net sheet */}
      <NetSheetReadOnlyCard dealId={deal.id} />

      {/* Review ask */}
      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5">
        <p className="text-sm font-black text-brand-navy mb-1">Leave us a quick review ⭐</p>
        <p className="text-xs text-gray-500 leading-relaxed mb-3">
          It only takes 23 seconds — and it means the world to us. Your review helps other families find the same great experience you had.
        </p>
        <a
          href="https://g.page/r/Cc0FtBCr37KfEBM/review"
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-navy py-3 text-sm font-bold text-white hover:bg-brand-navy/90 transition-colors"
        >
          ⭐ Leave a 5-Star Review (23 seconds)
        </a>
      </div>

      {/* Referral ask */}
      <div className="rounded-2xl border-2 border-brand-gold/40 bg-brand-gold/5 p-5">
        <p className="text-sm font-black text-brand-navy mb-1">Earn $50 per referral 🤝</p>
        <p className="text-xs text-gray-600 leading-relaxed mb-3">
          Know someone buying or selling? Send them our way and we&apos;ll pay you $50 for every referral who completes a transaction with us.
        </p>
        <button
          onClick={() => setShowReferral(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-gold py-3 text-sm font-bold text-brand-navy hover:bg-brand-gold/90 transition-colors"
        >
          Refer a friend →
        </button>
      </div>

      {/* What's next */}
      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-3">What&apos;s Next</p>
        <div className="space-y-2.5">
          {[
            { icon: Mail,     label: 'Update your mailing address everywhere' },
            { icon: Home,     label: 'Transfer or cancel utilities' },
            { icon: FileText, label: 'Keep your closing documents (tax time)' },
          ].map(({ icon: Icon, label }, i) => (
            <div key={i} className="flex items-center gap-3">
              <Icon size={14} className="text-gray-400 flex-shrink-0" />
              <span className="text-sm text-gray-600">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Referral modal */}
      {showReferral && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6">
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">🤝</div>
              <h3 className="text-xl font-black text-brand-navy">Refer a Friend, Earn $50</h3>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed text-center mb-5">
              Please refer us to all your friends and family who would love to share the same awesome experience you had with your home transaction. We will pay you <strong>$50 for every referral</strong> you send our way who completes a transaction with us.
            </p>
            <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 mb-4 flex items-center gap-2">
              <p className="flex-1 text-xs font-mono text-gray-600 truncate">realtourflow.com/refer</p>
              <button className="text-xs font-bold text-brand-navy hover:text-brand-navy/70 transition-colors flex-shrink-0">
                Copy
              </button>
            </div>
            <button
              onClick={() => setShowReferral(false)}
              className="w-full rounded-xl bg-brand-navy py-3 text-sm font-bold text-white hover:bg-brand-navy/90 transition-colors"
            >
              Got it!
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FallenThroughCard({ deal, firstName }: { deal: Deal; firstName: string }) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-gray-800 p-5 text-white">
        <div className="flex items-center gap-2 mb-2">
          <XCircle size={18} className="text-red-400" />
          <p className="text-xs font-bold uppercase tracking-widest text-white/50">Deal Fell Through</p>
        </div>
        <p className="text-lg font-bold">We&apos;re sorry, {firstName}.</p>
        {deal.fallReason && (
          <p className="text-sm text-white/60 mt-2 leading-relaxed">{deal.fallReason}</p>
        )}
      </div>
      <div className="rounded-2xl border border-purple-100 bg-purple-50 px-5 py-4">
        <p className="text-sm font-bold text-purple-800 mb-1">What happens next</p>
        <p className="text-xs text-purple-600 leading-relaxed">
          Your agent will discuss your options — whether that means going back on the market,
          re-negotiating, or a different approach. You&apos;re still in good hands.
        </p>
        <div className="mt-3 flex gap-2">
          <a href="tel:+12055550100"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-xs font-bold text-white hover:bg-purple-700 transition-colors">
            <Phone size={12} /> Call Agent
          </a>
          <a href="mailto:sarah@realtourflow.com"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white border border-purple-200 px-3 py-2 text-xs font-semibold text-purple-700 hover:bg-purple-50 transition-colors">
            <Mail size={12} /> Email Agent
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Offer Comparison ────────────────────────────────────────────────────────

type LocalOffer = {
  id: string;
  buyerName: string;
  price: number;
  financing: 'Conventional' | 'FHA' | 'VA' | 'Cash';
  earnestMoney: number;
  inspectionContingency: boolean;
  closingDate: string;
  concessions: number;
  submittedAt: string;
};

const MOCK_OFFERS: LocalOffer[] = [
  {
    id: 'offer-1',
    buyerName: 'The Patterson Family',
    price: 392000,
    financing: 'Conventional',
    earnestMoney: 7500,
    inspectionContingency: false,
    closingDate: '2026-03-28',
    concessions: 0,
    submittedAt: '2026-02-17',
  },
  {
    id: 'offer-2',
    buyerName: 'Marcus & Diane Liu',
    price: 387500,
    financing: 'Conventional',
    earnestMoney: 5000,
    inspectionContingency: true,
    closingDate: '2026-04-05',
    concessions: 3000,
    submittedAt: '2026-02-18',
  },
  {
    id: 'offer-3',
    buyerName: 'Kevin Okafor',
    price: 395000,
    financing: 'Cash',
    earnestMoney: 10000,
    inspectionContingency: false,
    closingDate: '2026-03-21',
    concessions: 0,
    submittedAt: '2026-02-19',
  },
];

function OfferComparison({ listPrice }: { listPrice: number }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const best = MOCK_OFFERS.reduce((a, b) => {
    const netA = a.price - a.concessions;
    const netB = b.price - b.concessions;
    return netA >= netB ? a : b;
  });

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-brand-navy">Offers Received</h3>
        <span className="rounded-full bg-brand-navy/10 px-2.5 py-0.5 text-xs font-bold text-brand-navy">
          {MOCK_OFFERS.length} offers
        </span>
      </div>

      {/* Offer cards */}
      {MOCK_OFFERS.map((offer) => {
        const isSelected = selectedId === offer.id;
        const isBest = offer.id === best.id;
        const overList = offer.price - listPrice;
        const net = offer.price - offer.concessions;

        return (
          <div
            key={offer.id}
            className={[
              'rounded-2xl border bg-white shadow-sm overflow-hidden transition-all',
              isBest ? 'border-brand-gold ring-1 ring-brand-gold/30' : 'border-gray-100',
            ].join(' ')}
          >
            {/* Card header */}
            <button
              type="button"
              onClick={() => setSelectedId(isSelected ? null : offer.id)}
              className="w-full text-left px-4 py-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="font-bold text-brand-navy text-sm">{offer.buyerName}</span>
                    {isBest && (
                      <span className="rounded-full bg-brand-gold/20 border border-brand-gold/40 px-2 py-0.5 text-[10px] font-bold text-brand-navy uppercase tracking-wide">
                        Best Offer
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400 flex-wrap">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600">
                      {offer.financing}
                    </span>
                    <span>Submitted {offer.submittedAt}</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-lg font-black text-brand-navy leading-none">
                    ${offer.price.toLocaleString()}
                  </p>
                  {overList > 0 ? (
                    <p className="text-[11px] font-semibold text-green-600 mt-0.5">
                      +${overList.toLocaleString()} over ask
                    </p>
                  ) : overList < 0 ? (
                    <p className="text-[11px] font-semibold text-red-500 mt-0.5">
                      ${Math.abs(overList).toLocaleString()} under ask
                    </p>
                  ) : (
                    <p className="text-[11px] text-gray-400 mt-0.5">At ask</p>
                  )}
                </div>
              </div>
            </button>

            {/* Expanded details */}
            {isSelected && (
              <div className="border-t border-gray-100 px-4 py-4 bg-gray-50 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Net to Seller', value: `$${net.toLocaleString()}`, highlight: true },
                    { label: 'Earnest Money', value: `$${offer.earnestMoney.toLocaleString()}` },
                    { label: 'Concessions', value: offer.concessions > 0 ? `-$${offer.concessions.toLocaleString()}` : 'None', warn: offer.concessions > 0 },
                    { label: 'Target Close', value: offer.closingDate },
                    { label: 'Inspection', value: offer.inspectionContingency ? 'Contingent' : 'Waived', warn: offer.inspectionContingency, good: !offer.inspectionContingency },
                    { label: 'Financing', value: offer.financing },
                  ].map(({ label, value, highlight, warn, good }) => (
                    <div key={label} className="rounded-xl bg-white border border-gray-100 px-3 py-2.5">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-0.5">{label}</p>
                      <p className={`text-sm font-bold ${
                        highlight ? 'text-brand-navy' :
                        warn ? 'text-amber-600' :
                        good ? 'text-green-600' :
                        'text-gray-700'
                      }`}>{value}</p>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-1">
                  <button className="flex-1 rounded-xl bg-brand-navy py-2 text-xs font-bold text-white hover:bg-brand-navy/90 transition-colors">
                    Accept
                  </button>
                  <button className="flex-1 rounded-xl border border-gray-200 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition-colors">
                    Counter
                  </button>
                  <button className="flex-1 rounded-xl border border-red-100 bg-red-50 py-2 text-xs font-semibold text-red-500 hover:bg-red-100 transition-colors">
                    Decline
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <p className="text-center text-xs text-gray-400 pt-1">
        Tap any offer to see full details. Your agent will guide you through the decision.
      </p>
    </div>
  );
}

// ─── Stage card dispatcher ────────────────────────────────────────────────────

function StageCard({ deal, firstName }: { deal: Deal; firstName: string }) {
  if (deal.status === 'fallen_through') return <FallenThroughCard deal={deal} firstName={firstName} />;
  switch (deal.stage) {
    case 'intake':         return <IntakeCard firstName={firstName} />;
    case 'active_search':  return <ListingPrepCard />;
    case 'offer_active':   return <ListingActiveCard deal={deal} />;
    case 'under_contract': return <UnderContractCard deal={deal} />;
    case 'pre_close':      return <PreCloseCard deal={deal} />;
    case 'closing':        return <ClosingCard deal={deal} />;
    case 'post_close':     return <PostCloseCard deal={deal} firstName={firstName} />;
  }
}

// ─── Smooth Exit pitch ────────────────────────────────────────────────────────

function SmoothExitPitch() {
  const router = useRouter();
  return (
    <div className="rounded-2xl overflow-hidden border-2 border-purple-200 bg-purple-50">
      <div className="p-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">🚪</span>
          <span className="text-xs font-bold uppercase tracking-widest text-purple-600">Seller Concierge</span>
        </div>
        <div className="text-lg font-black text-purple-900">Smooth Exit</div>
        <p className="mt-1.5 text-sm text-purple-800/80 leading-relaxed">
          We coordinate your move-out, handle utility cancellations, get repair bids, and support you all the way through closing — so you can focus on what&apos;s next.
        </p>
        <div className="mt-3 inline-block rounded-lg bg-purple-100 px-3 py-1.5 text-sm font-black text-purple-800">
          1% of sale price · paid from proceeds
        </div>
        <div className="mt-2 rounded-lg bg-white border border-purple-200 px-3 py-2 text-xs text-purple-700 font-medium">
          🏡 Includes Buy Before You Sell — buy your next home before this one closes
        </div>
      </div>
      <div className="border-t border-purple-200 px-5 py-3 flex items-center gap-3">
        <button
          onClick={() => router.push('/smooth-exit')}
          className="text-xs font-semibold text-purple-700 hover:text-purple-900 transition-colors"
        >
          Learn more →
        </button>
        <button
          onClick={() => router.push('/smooth-exit/survey')}
          className="ml-auto rounded-xl bg-purple-700 px-5 py-2 text-xs font-bold text-white hover:bg-purple-800 transition-colors active:scale-[0.98]"
        >
          Get Started
        </button>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function SellerView() {
  const activeUser = useAuthStore((s) => s.activeUser);
  const [activeTab, setActiveTab] = useState<Tab>('tasks');
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [showWelcome, setShowWelcome] = useState(() => {
    const flag = sessionStorage.getItem('seller_welcomed');
    if (flag) { sessionStorage.removeItem('seller_welcomed'); return true; }
    return false;
  });

  // Notifications are pulled via <ClientNotifications /> which uses useNotifications hook
  const { deals, loading: dealsLoading } = useMyDeals();
  const deal = deals.find((d) => d.type === 'sell');
  const { tasks } = useTasks(deal?.id ?? '');
  const sellerTasks = tasks.filter((t) => t.assignedTo === 'seller');
  const openTasks = sellerTasks.filter((t) => t.status !== 'completed' && !completedIds.has(t.id));
  const { slots: availability } = useShowingAvailability(deal?.id);
  const [showingModalDismissed, setShowingModalDismissed] = useState(
    () => !!sessionStorage.getItem(`showing_avail_prompted_${deal?.id ?? ''}`)
  );

  function handleComplete(id: string) {
    setCompletedIds((prev) => new Set([...prev, id]));
  }

  if (dealsLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Loader2 size={24} className="text-brand-navy animate-spin" />
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-gray-400 text-sm">No active deal found.</p>
      </div>
    );
  }

  const firstName = activeUser?.name.split(' ')[0] ?? 'there';
  const isFallenThrough = deal.status === 'fallen_through';


  return (
    <div className="mx-auto max-w-lg space-y-4 pb-10">
      {/* Auto showing availability modal for offer_active stage */}
      {deal.stage === 'offer_active' && availability.length === 0 && !showingModalDismissed && (
        <ShowingAvailabilityModal
          dealId={deal.id}
          onClose={() => {
            sessionStorage.setItem(`showing_avail_prompted_${deal.id}`, '1');
            setShowingModalDismissed(true);
          }}
        />
      )}

      <ClientNotifications />

      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-brand-navy">
          {isFallenThrough ? `Hi, ${firstName}` : `Hi, ${firstName}!`}
        </h1>
        <div className={`mt-3 rounded-2xl bg-white shadow-sm p-4 ${
          isFallenThrough ? 'border-l-4 border-l-gray-400' :
          deal.health === 'green'  ? 'border-l-4 border-l-green-400' :
          deal.health === 'yellow' ? 'border-l-4 border-l-amber-400' :
                                     'border-l-4 border-l-red-400'
        }`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-0.5">
                <MapPin size={11} />
                <span className="truncate">{deal.property.address}, {deal.property.city}</span>
              </div>
              <p className="font-bold text-brand-navy text-lg">${deal.property.price.toLocaleString()}</p>
              {deal.smoothExit?.status === 'active' && (
                <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-purple-100 border border-purple-200 px-2 py-0.5 text-[11px] font-bold text-purple-700">
                  Smooth Exit Active
                </span>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                isFallenThrough
                  ? 'bg-gray-100 text-gray-500 border-gray-200'
                  : deal.health === 'green'  ? 'bg-green-100 text-green-700 border-green-200'
                  : deal.health === 'yellow' ? 'bg-amber-100 text-amber-700 border-amber-200'
                  :                            'bg-red-100 text-red-700 border-red-200'
              }`}>
                {isFallenThrough ? 'Fell Through' : SELLER_STAGE_LABELS[deal.stage]}
              </span>
              {deal.timeline.closingDate && !isFallenThrough && (
                <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-gray-400">
                  <Calendar size={10} /> Closing {deal.timeline.closingDate}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stage-specific card */}
      <StageCard deal={deal} firstName={firstName} />

      {/* Smooth Exit pitch — only if not enrolled */}
      {!deal.smoothExit?.status && !isFallenThrough && deal.stage !== 'post_close' && (
        <SmoothExitPitch />
      )}

      {/* Offer comparison — only at offer_active stage */}
      {deal.stage === 'offer_active' && !isFallenThrough && (
        <OfferComparison listPrice={deal.property.price} />
      )}

      {/* Overdue alert */}
      {!isFallenThrough && sellerTasks.some((t) => t.status === 'overdue') && (
        <div className="flex items-center gap-3 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
          <AlertCircle size={18} className="text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-700">You have overdue tasks</p>
            <p className="text-xs text-red-400">Your agent is waiting — take a look below</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      {!isFallenThrough && deal.stage !== 'post_close' && (
        <>
          <TabBar
            active={activeTab}
            onChange={setActiveTab}
            taskCount={openTasks.length}
            msgCount={0}
          />
          {activeTab === 'tasks' && (
            <div className="space-y-2">
              {openTasks.length === 0 && (
                <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
                  <CheckCircle2 size={32} className="mx-auto mb-2 text-green-400" />
                  <p className="text-sm font-medium text-gray-500">
                    {deal.stage === 'intake' ? 'Tasks unlock after your consultation.' : 'All caught up — great work!'}
                  </p>
                </div>
              )}
              {openTasks.filter((t) => t.status === 'overdue').map((t) => <TaskCard key={t.id} task={t} onComplete={handleComplete} />)}
              {openTasks.filter((t) => t.status === 'in_progress').map((t) => <TaskCard key={t.id} task={t} onComplete={handleComplete} />)}
              {openTasks.filter((t) => t.status === 'pending').map((t) => <TaskCard key={t.id} task={t} onComplete={handleComplete} />)}
              {(sellerTasks.filter((t) => t.status === 'completed').length + completedIds.size) > 0 && (
                <p className="text-center text-xs text-gray-300 pt-1">
                  {sellerTasks.filter((t) => t.status === 'completed').length + completedIds.size} task{(sellerTasks.filter((t) => t.status === 'completed').length + completedIds.size) !== 1 ? 's' : ''} completed
                </p>
              )}
            </div>
          )}
          {activeTab === 'messages' && <MessagesTab dealId={deal.id} />}
          {activeTab === 'documents' && <DocumentsTab />}
        </>
      )}

      {isFallenThrough && <MessagesTab dealId={deal.id} />}

      <JourneyTracker deal={deal} />
      <VendorDirectory agentId={deal.agentId} />
      <AgentCard agentName={deal.agentName} agentEmail={deal.agentEmail} agentPhone={deal.agentPhone} />

      {/* Welcome modal — shown once after onboarding completes */}
      {showWelcome && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-white shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-br from-purple-600 to-indigo-700 px-6 pt-8 pb-6 text-center">
              <div className="text-5xl mb-3">🏡</div>
              <h2 className="text-2xl font-black text-white leading-snug">
                You&apos;re all set!
              </h2>
            </div>
            <div className="px-6 py-6 text-center">
              <p className="text-base text-gray-700 leading-relaxed">
                Thank you so much. Your agent will reach out with next steps. They are starting to prepare your house to sell like a pro.
              </p>
              <button
                onClick={() => setShowWelcome(false)}
                className="mt-6 w-full rounded-xl bg-purple-700 py-3.5 text-base font-bold text-white hover:bg-purple-800 transition-all active:scale-[0.98]"
              >
                Got it!
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
