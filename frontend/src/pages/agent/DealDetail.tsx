import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Deal, DealStage, LoanMilestones } from '../../data/mockDeals';
import { useDeal, patchStage } from '../../hooks/useDeals';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { usePermission } from '../../permissions/usePermission';
import { PERMISSIONS } from '../../permissions/permissions';
import { useTaskStore } from '../../store/taskStore';
import { useNotificationStore } from '../../store/notificationStore';
import { Task } from '../../data/mockTasks';
import { useTasks, patchTaskStatus, postTask } from '../../hooks/useTasks';
import { useDocuments, requestUploadUrl, confirmUpload, getDownloadUrl, deleteDocument, Document as ApiDocument } from '../../hooks/useDocuments';
import { useMessages, postMessage, MessageChannel } from '../../hooks/useMessages';
import { useVendors } from '../../hooks/useVendors';
import {
  ArrowLeft,
  MapPin,
  Calendar,
  Clock,
  CheckCircle2,
  Circle,
  AlertCircle,
  Loader2,
  MessageSquare,
  FileText,
  LayoutDashboard,
  CheckSquare,
  GitBranch,
  Zap,
  Bot,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  Building2,
  Phone,
  Mail,
  RefreshCw,
  Pencil,
  Plus,
  X,
  Star,
  Users,
  ExternalLink,
  AlertTriangle,
  Home,
  Link as LinkIcon,
  Lock,
  DollarSign,
  LogOut,
} from 'lucide-react';
import MetroMap from '../../components/MetroMap';
import { MOCK_USERS } from '../../data/mockUsers';
import { useDealStageStore } from '../../store/dealStageStore';
import { useParticipants } from '../../hooks/useParticipants';
import { useProperties, TrackedProperty, PropertyStatus } from '../../hooks/useProperties';
import { useShowingAvailability, DAYS_OF_WEEK, ShowingSlot, DayOfWeek } from '../../hooks/useShowingAvailability';
import { useOffers, Offer } from '../../hooks/useOffers';
import { useNetSheet, NetSheetLine, recalcLines, calcNetProceeds } from '../../hooks/useNetSheet';
import {
  VENDOR_CATEGORY_LABELS,
  VENDOR_CATEGORY_ORDER,
  VendorCategory,
} from '../../data/mockVendors';

// ─── Types & Helpers ────────────────────────────────────────────────────────

const STAGE_LABELS: Record<DealStage, string> = {
  intake: 'Intake',
  active_search: 'Active Search',
  offer_active: 'Offer Active',
  under_contract: 'Under Contract',
  pre_close: 'Pre-Close',
  closing: 'Closing',
  post_close: 'Post-Close',
};

const STAGE_ORDER: DealStage[] = [
  'intake',
  'active_search',
  'offer_active',
  'under_contract',
  'pre_close',
  'closing',
  'post_close',
];

// ─── Stage Automation ────────────────────────────────────────────────────────

type AutoTask = {
  title: string;
  description?: string;
  assignedTo: 'agent' | 'tc';
  priority: 'high' | 'medium' | 'low';
};

const STAGE_AUTO_TASKS: Partial<Record<DealStage, (deal: Deal) => AutoTask[]>> = {
  active_search: (d) => [
    ...(d.type === 'buy' ? [
      { title: `Send pre-approval checklist — ${d.clientName}`, assignedTo: 'agent' as const, priority: 'high' as const },
      { title: 'Schedule initial buyer consultation', assignedTo: 'agent' as const, priority: 'medium' as const },
      { title: 'Set up saved MLS search for client', assignedTo: 'agent' as const, priority: 'medium' as const },
    ] : [
      { title: `Schedule listing strategy call — ${d.clientName}`, assignedTo: 'agent' as const, priority: 'high' as const },
      { title: 'Pull comparable sales (CMA)', assignedTo: 'agent' as const, priority: 'high' as const },
      { title: 'Order professional photography', assignedTo: 'agent' as const, priority: 'medium' as const },
    ]),
  ],
  offer_active: (d) => [
    ...(d.type === 'buy' ? [
      { title: `Review offer details with ${d.clientName}`, assignedTo: 'agent' as const, priority: 'high' as const },
      { title: 'Prepare purchase agreement', assignedTo: 'agent' as const, priority: 'high' as const },
      { title: 'Submit offer to listing agent', assignedTo: 'agent' as const, priority: 'high' as const },
      { title: `Send earnest money instructions — ${d.clientName}`, assignedTo: 'tc' as const, priority: 'high' as const },
    ] : [
      { title: `Review offer with ${d.clientName}`, assignedTo: 'agent' as const, priority: 'high' as const },
      { title: 'Request proof of funds / pre-approval from buyer', assignedTo: 'agent' as const, priority: 'high' as const },
      { title: 'Prepare counter offer if applicable', assignedTo: 'agent' as const, priority: 'medium' as const },
    ]),
  ],
  under_contract: (d) => [
    ...(d.type === 'buy' ? [
      { title: `Schedule home inspection — ${d.clientName}`, assignedTo: 'agent' as const, priority: 'high' as const },
      { title: 'Send executed contract to TC', assignedTo: 'agent' as const, priority: 'high' as const },
      { title: 'Open title file with title company', assignedTo: 'tc' as const, priority: 'high' as const },
      { title: `Confirm loan milestones with lender — ${d.clientName}`, assignedTo: 'agent' as const, priority: 'medium' as const },
      { title: `Send wire / EMD instructions to ${d.clientName}`, assignedTo: 'tc' as const, priority: 'high' as const },
    ] : [
      { title: 'Send executed contract to TC', assignedTo: 'agent' as const, priority: 'high' as const },
      { title: 'Open title file with title company', assignedTo: 'tc' as const, priority: 'high' as const },
      { title: `Respond to repair request — ${d.clientName}`, description: 'Seller must respond within the contractual deadline', assignedTo: 'agent' as const, priority: 'high' as const },
      { title: 'Confirm appraisal scheduling with buyer agent', assignedTo: 'agent' as const, priority: 'medium' as const },
    ]),
  ],
  pre_close: (d) => [
    { title: `Schedule final walkthrough — ${d.clientName}`, assignedTo: 'agent' as const, priority: 'high' as const },
    { title: 'Verify clear-to-close status with lender', assignedTo: 'agent' as const, priority: 'high' as const },
    { title: 'Confirm closing time and location with title company', assignedTo: 'tc' as const, priority: 'high' as const },
    { title: `Remind ${d.clientName} to bring government ID to closing`, assignedTo: 'agent' as const, priority: 'medium' as const },
    { title: 'Review ALTA / HUD-1 settlement statement', assignedTo: 'tc' as const, priority: 'high' as const },
  ],
  closing: (d) => [
    { title: 'Confirm all parties for closing', assignedTo: 'tc' as const, priority: 'high' as const },
    { title: `Verify wire instructions with ${d.clientName}`, assignedTo: 'agent' as const, priority: 'high' as const },
    { title: 'Final clear-to-close check', assignedTo: 'tc' as const, priority: 'high' as const },
  ],
  post_close: (d) => [
    { title: `Request 5-star review — ${d.clientName}`, assignedTo: 'agent' as const, priority: 'high' as const },
    { title: `Send $50 referral program info to ${d.clientName}`, assignedTo: 'agent' as const, priority: 'medium' as const },
    { title: 'Submit commission paperwork to brokerage', assignedTo: 'agent' as const, priority: 'high' as const },
    { title: 'Update CRM with closed deal status', assignedTo: 'agent' as const, priority: 'low' as const },
  ],
};

const STAGE_DRAFT_MESSAGE: Partial<Record<DealStage, (deal: Deal) => string>> = {
  active_search: (d) => d.type === 'buy'
    ? `Hi ${d.clientName.split(' ')[0]}! Your home search portal is officially open. I'm setting up a custom property search for you now and will start sending listings your way. Your first step is completing the intake questionnaire in your portal — it only takes a few minutes!`
    : `Hi ${d.clientName.split(' ')[0]}! I've opened your seller portal and we're moving into listing prep. I'll be in touch shortly to schedule your listing strategy call. In the meantime, take a look at the prep checklist in your portal!`,
  offer_active: (d) => d.type === 'buy'
    ? `Great news, ${d.clientName.split(' ')[0]}! Your offer on ${d.property.address} has been submitted. Keep your phone nearby — the seller typically responds within 24–48 hours and I may need a quick answer from you if they counter.`
    : `${d.clientName.split(' ')[0]}, you have an offer on the table! I'm reviewing the details now and will call you shortly to walk through everything.`,
  under_contract: (d) => d.type === 'buy'
    ? `Congratulations, ${d.clientName.split(' ')[0]}! You're officially under contract on ${d.property.address}. I've kicked off the inspection scheduling and your loan team has been notified. Track every milestone in your portal — I'll keep it updated in real time.`
    : `${d.clientName.split(' ')[0]}, you have an accepted offer! The buyer's inspection, financing, and appraisal are all being tracked in your portal. I'll keep you posted as each milestone is hit.`,
  pre_close: (d) =>
    `${d.clientName.split(' ')[0]}, we're almost there! I'll be reaching out this week to schedule your final walkthrough. Closing is coming up fast — let me know if you have any questions before the big day.`,
  closing: (d) =>
    `${d.clientName.split(' ')[0]}, it's closing day! Everything is confirmed. Don't forget to bring a government-issued photo ID. I'll see you there!`,
  post_close: (d) => d.type === 'buy'
    ? `Congratulations, ${d.clientName.split(' ')[0]}! You're officially a homeowner! 🏡 It was such a pleasure helping you through this. Check your portal for your move-in checklist. When you get a moment, a quick review would mean the world to us!`
    : `Congratulations, ${d.clientName.split(' ')[0]}! Your home has officially sold! 🎉 Your net proceeds summary is in your portal. It was a pleasure working with you — if you know anyone buying or selling, send them our way and we'll pay you $50!`,
};

const HEALTH_BORDER: Record<string, string> = {
  green: 'border-green-400',
  yellow: 'border-amber-400',
  red: 'border-red-400',
};

const HEALTH_BADGE: Record<string, string> = {
  green: 'bg-green-100 text-green-700',
  yellow: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
};

const TASK_STATUS_ICON: Record<string, React.ReactNode> = {
  completed: <CheckCircle2 size={16} className="text-green-500" />,
  in_progress: <Loader2 size={16} className="text-blue-500 animate-spin" />,
  overdue: <AlertCircle size={16} className="text-red-500" />,
  pending: <Circle size={16} className="text-gray-300" />,
  blocked: <AlertCircle size={16} className="text-orange-500" />,
};

const TASK_ASSIGNEE_COLORS: Record<string, string> = {
  agent: 'bg-blue-100 text-blue-700',
  buyer: 'bg-green-100 text-green-700',
  seller: 'bg-purple-100 text-purple-700',
  tc: 'bg-amber-100 text-amber-700',
  admin: 'bg-red-100 text-red-700',
  third_party: 'bg-gray-100 text-gray-600',
};

const FLAG_LABELS: Record<string, string> = {
  fast_pass: 'Fast Pass',
  repair_request: 'Repair Request',
  mountain_mortgage: 'Mtn Mortgage',
  asap_timeline: 'ASAP Timeline',
  also_buying: 'Also Buying',
};

function formatTimestamp(ts: string) {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ─── Tab definitions ────────────────────────────────────────────────────────

type TabId = 'overview' | 'tasks' | 'messages' | 'documents' | 'timeline' | 'vendors';

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'overview',  label: 'Overview',  icon: LayoutDashboard },
  { id: 'timeline',  label: 'Timeline',  icon: GitBranch },
  { id: 'tasks',     label: 'Tasks',     icon: CheckSquare },
  { id: 'messages',  label: 'Messages',  icon: MessageSquare },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'vendors',   label: 'Vendors',   icon: Building2 },
];

// ─── Seller: Showing Availability Editor ─────────────────────────────────────

function SellerShowingAvailabilityCard({ dealId }: { dealId: string }) {
  const { slots: availability, saveSlots } = useShowingAvailability(dealId);
  const [editing, setEditing] = useState(false);
  const [enabled, setEnabled] = useState<Set<DayOfWeek>>(new Set());
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
    const newSlots: ShowingSlot[] = DAYS_OF_WEEK
      .filter((d) => enabled.has(d))
      .map((d) => ({ day: d, from: times[d].from, to: times[d].to }));
    await saveSlots(newSlots).catch(() => {});
    setEditing(false);
  }

  function startEdit() {
    setEnabled(new Set(availability.map((s) => s.day)));
    const curr: Record<DayOfWeek, { from: string; to: string }> = {
      Mon: { from: '09:00', to: '18:00' }, Tue: { from: '09:00', to: '18:00' },
      Wed: { from: '09:00', to: '18:00' }, Thu: { from: '09:00', to: '18:00' },
      Fri: { from: '09:00', to: '18:00' }, Sat: { from: '10:00', to: '15:00' },
      Sun: { from: '12:00', to: '15:00' },
    };
    for (const slot of availability) {
      curr[slot.day] = { from: slot.from, to: slot.to };
    }
    setTimes(curr);
    setEditing(true);
  }

  return (
    <div className="rounded-xl bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-brand-navy" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">Showing Availability</h3>
        </div>
        {!editing && (
          <button
            onClick={startEdit}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <Pencil size={11} /> {availability.length > 0 ? 'Edit' : 'Set'}
          </button>
        )}
      </div>

      {!editing ? (
        availability.length === 0 ? (
          <div className="px-5 py-4 text-center">
            <p className="text-sm text-gray-400">No availability set by seller yet.</p>
            <button
              onClick={startEdit}
              className="mt-2 rounded-lg bg-brand-navy px-4 py-2 text-xs font-bold text-white hover:bg-brand-navy/80 transition-colors"
            >
              Set for them
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
        )
      ) : (
        <div className="px-5 py-4 space-y-3">
          {DAYS_OF_WEEK.map((day) => {
            const on = enabled.has(day);
            return (
              <div key={day} className={`rounded-xl border transition-all ${on ? 'border-brand-navy/20 bg-brand-navy/5' : 'border-gray-100 bg-gray-50'}`}>
                <div className="flex items-center gap-3 px-4 py-2.5">
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
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setEditing(false)}
              className="flex-1 rounded-xl border border-gray-200 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="flex-1 rounded-xl bg-brand-navy py-2 text-sm font-bold text-white hover:bg-brand-navy/90 transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Seller: Offer Management ─────────────────────────────────────────────────

const CONTINGENCY_OPTIONS = ['Inspection', 'Financing', 'Appraisal', 'Sale of Home'];

function SellerOffersCard({ dealId }: { dealId: string }) {
  const { offers, addOffer, removeOffer } = useOffers(dealId);
  const [showForm, setShowForm] = useState(false);
  const [buyerName, setBuyerName] = useState('');
  const [offerPrice, setOfferPrice] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [contingencies, setContingencies] = useState<string[]>([]);
  const [agentNotes, setAgentNotes] = useState('');

  function toggleContingency(c: string) {
    setContingencies((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  }

  async function handleAdd() {
    if (!buyerName.trim() || !offerPrice) return;
    await addOffer({
      buyerName: buyerName.trim(),
      offerPrice: parseInt(offerPrice.replace(/\D/g, ''), 10) || 0,
      closeDate: closeDate || undefined,
      contingencies,
      agentNotes: agentNotes.trim(),
    }).catch(() => {});
    setBuyerName(''); setOfferPrice(''); setCloseDate('');
    setContingencies([]); setAgentNotes('');
    setShowForm(false);
  }

  return (
    <div className="rounded-xl bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <DollarSign size={14} className="text-brand-navy" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">
            Offers ({offers.length})
          </h3>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 rounded-lg bg-brand-navy px-2.5 py-1.5 text-xs font-bold text-white hover:bg-brand-navy/80 transition-colors"
        >
          <Plus size={11} /> Add Offer
        </button>
      </div>

      {showForm && (
        <div className="px-5 py-4 bg-blue-50/40 border-b border-gray-100 space-y-3">
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Buyer Name <span className="text-red-400">*</span></label>
            <input
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
              placeholder="e.g. The Johnson Family"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none text-brand-navy placeholder:text-gray-300"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Offer Price <span className="text-red-400">*</span></label>
            <input
              value={offerPrice}
              onChange={(e) => setOfferPrice(e.target.value)}
              placeholder="$385,000"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none text-brand-navy placeholder:text-gray-300"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Close Date</label>
            <input
              type="date"
              value={closeDate}
              onChange={(e) => setCloseDate(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none text-brand-navy"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Contingencies</label>
            <div className="flex flex-wrap gap-2">
              {CONTINGENCY_OPTIONS.map((c) => (
                <button
                  key={c}
                  onClick={() => toggleContingency(c)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                    contingencies.includes(c)
                      ? 'border-brand-navy bg-brand-navy text-white'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Agent Notes (visible to seller)</label>
            <textarea
              value={agentNotes}
              onChange={(e) => setAgentNotes(e.target.value)}
              placeholder="Notes about this offer for the seller..."
              rows={2}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none text-brand-navy resize-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="flex-1 rounded-lg border border-gray-200 py-2 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!buyerName.trim() || !offerPrice}
              className="flex-1 rounded-lg bg-brand-navy py-2 text-sm font-bold text-white disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
            >
              Add Offer
            </button>
          </div>
        </div>
      )}

      {offers.length === 0 && !showForm ? (
        <div className="px-5 py-6 text-center">
          <p className="text-sm text-gray-400">No offers added yet.</p>
          <p className="text-xs text-gray-300 mt-0.5">Add offers here — they'll appear on the seller's portal.</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-50">
          {offers.map((offer) => (
            <div key={offer.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <p className="text-base font-black text-brand-navy">${offer.offerPrice.toLocaleString()}</p>
                  <p className="text-xs text-gray-400">{offer.buyerName}{offer.closeDate ? ` · Close ${offer.closeDate}` : ''}</p>
                  {offer.contingencies.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {offer.contingencies.map((c) => (
                        <span key={c} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">{c}</span>
                      ))}
                    </div>
                  )}
                  {offer.agentNotes && (
                    <p className="text-xs text-gray-500 italic mt-1.5 leading-relaxed">"{offer.agentNotes}"</p>
                  )}
                </div>
                <button
                  onClick={() => removeOffer(offer.id, dealId)}
                  className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Seller: Buyer Status Setter ──────────────────────────────────────────────

const BUYER_STATUS_OPTIONS = [
  'Inspection scheduled',
  'Inspection complete',
  'Appraisal ordered',
  'Appraisal complete',
  'Financing in review',
  'Financing approved',
  'Clear to close',
];

function SellerBuyerStatusCard({ dealId }: { dealId: string }) {
  const { buyerStatusByDeal, setBuyerStatus } = useDealStageStore();
  const current = buyerStatusByDeal[dealId] ?? '';

  return (
    <div className="rounded-xl bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100">
        <CheckCircle2 size={14} className="text-brand-navy" />
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">Buyer's Progress</h3>
      </div>
      <div className="px-5 py-4">
        <p className="text-xs text-gray-400 mb-2">Set the buyer's current status — this shows up on the seller's portal.</p>
        <select
          value={current}
          onChange={(e) => setBuyerStatus(dealId, e.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-brand-navy outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10"
        >
          <option value="">— Not set —</option>
          {BUYER_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {current && (
          <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-green-50 border border-green-100 px-3 py-2">
            <CheckCircle2 size={12} className="text-green-500" />
            <span className="text-xs font-semibold text-green-700">Currently showing: {current}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Seller: Net Sheet Editor ─────────────────────────────────────────────────

function printNetSheet(deal: { clientName: string; property: { address: string } }, lines: NetSheetLine[], salePrice: number, netProceeds: number, closingDate: string | null) {
  const enabledLines = lines.filter((l) => l.enabled);
  const fmt = (n: number) => `$${Math.abs(n).toLocaleString()}`;
  const rows = enabledLines.map((l) => `
    <tr>
      <td style="padding:6px 0;color:#555;font-size:13px;">${l.label}${l.isPct && l.pct ? ` (${l.pct}%)` : ''}</td>
      <td style="padding:6px 0;text-align:right;color:#222;font-size:13px;">-${fmt(l.amount)}</td>
    </tr>`).join('');
  const html = `<!DOCTYPE html><html><head><title>Net Sheet — ${deal.clientName}</title>
  <style>body{font-family:Arial,sans-serif;max-width:600px;margin:40px auto;color:#222;}
  h1{font-size:22px;color:#1a2e4a;margin-bottom:4px;}
  .sub{font-size:13px;color:#777;margin-bottom:24px;}
  table{width:100%;border-collapse:collapse;}
  .divider{border-top:2px solid #1a2e4a;margin:8px 0;}
  .net{font-size:18px;font-weight:bold;color:#1a2e4a;}
  @media print{@page{margin:1in}}
  </style></head><body>
  <h1>Estimated Net Sheet</h1>
  <p class="sub">${deal.clientName} · ${deal.property.address}${closingDate ? ' · Closing ' + closingDate : ''}</p>
  <table>
    <tr><td style="padding:6px 0;font-size:13px;color:#555;">Sale Price</td>
        <td style="padding:6px 0;text-align:right;font-size:13px;color:#222;">+${fmt(salePrice)}</td></tr>
    ${rows}
    <tr><td colspan="2" class="divider"></td></tr>
    <tr><td style="padding:8px 0;" class="net">Estimated Net Proceeds</td>
        <td style="padding:8px 0;text-align:right;" class="net">${fmt(netProceeds)}</td></tr>
  </table>
  <p style="margin-top:32px;font-size:11px;color:#aaa;">Generated by RealTourFlow · Estimate only — actual figures provided by title at closing.</p>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.onload = () => w.print();
}

function SellerNetSheetCard({ deal }: { deal: import('../../data/mockDeals').Deal }) {
  const { sheet, loading, saveSheet, markReady } = useNetSheet(deal.id);
  const [lines, setLines] = useState<NetSheetLine[]>([]);
  const [salePrice, setSalePrice] = useState(deal.property.price);
  const [closingDate, setClosingDate] = useState<string>(deal.timeline.closingDate ?? '');
  const [annualTaxes, setAnnualTaxes] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showOptional, setShowOptional] = useState(false);

  useEffect(() => {
    if (!sheet) return;
    setSalePrice(sheet.salePrice || deal.property.price);
    setClosingDate(sheet.closingDate ?? deal.timeline.closingDate ?? '');
    setAnnualTaxes(sheet.annualTaxes);
    setLines(recalcLines(sheet.lines, sheet.salePrice || deal.property.price, sheet.annualTaxes, sheet.closingDate));
  }, [sheet]);

  const liveLines = recalcLines(lines, salePrice, annualTaxes, closingDate || null);
  const netProceeds = calcNetProceeds(liveLines, salePrice);
  const isReady = sheet?.status === 'ready';

  function updateLine(id: string, patch: Partial<NetSheetLine>) {
    setLines((prev) => prev.map((l) => l.id === id ? { ...l, ...patch } : l));
  }

  async function handleSave() {
    if (!sheet) return;
    setSaving(true);
    try {
      await saveSheet({ ...sheet, salePrice, closingDate: closingDate || null, annualTaxes, lines: liveLines });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleReady() {
    await markReady(!isReady).catch(() => {});
  }

  const requiredLines = liveLines.filter((l) => l.required);
  const optionalLines = liveLines.filter((l) => !l.required);
  const enabledOptional = optionalLines.filter((l) => l.enabled).length;

  if (loading) return (
    <div className="rounded-xl bg-white shadow-sm p-8 flex justify-center">
      <Loader2 size={20} className="animate-spin text-brand-navy/40" />
    </div>
  );

  return (
    <div className="rounded-xl bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <DollarSign size={14} className="text-brand-navy" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">Net Sheet</h3>
          {isReady && (
            <span className="flex items-center gap-1 rounded-full bg-green-100 border border-green-200 px-2 py-0.5 text-[10px] font-bold text-green-700">
              <CheckCircle2 size={9} /> Sent to Client
            </span>
          )}
        </div>
        {saved && <span className="text-xs font-semibold text-green-600 flex items-center gap-1"><CheckCircle2 size={11} /> Saved</span>}
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Sale price + closing date */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Sale Price</label>
            <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2">
              <span className="text-sm text-gray-400">$</span>
              <input type="number" value={salePrice}
                onChange={(e) => setSalePrice(parseInt(e.target.value) || 0)}
                className="flex-1 text-sm outline-none bg-transparent text-brand-navy min-w-0" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Closing Date</label>
            <input type="date" value={closingDate}
              onChange={(e) => setClosingDate(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none text-brand-navy" />
          </div>
          <div className="col-span-2">
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Annual Property Taxes (for proration)</label>
            <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2">
              <span className="text-sm text-gray-400">$</span>
              <input type="number" value={annualTaxes}
                onChange={(e) => setAnnualTaxes(parseInt(e.target.value) || 0)}
                placeholder="0"
                className="flex-1 text-sm outline-none bg-transparent text-brand-navy min-w-0" />
            </div>
          </div>
        </div>

        {/* Required lines */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Deductions</p>
          {requiredLines.map((line) => (
            <NetSheetLineRow key={line.id} line={line} salePrice={salePrice}
              onChange={(patch) => updateLine(line.id, patch)} />
          ))}
        </div>

        {/* Optional lines */}
        <div>
          <button
            onClick={() => setShowOptional((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold text-brand-navy hover:text-brand-navy/70 transition-colors"
          >
            <ChevronDown size={13} className={`transition-transform ${showOptional ? 'rotate-180' : ''}`} />
            Optional lines {enabledOptional > 0 ? `(${enabledOptional} active)` : ''}
          </button>
          {showOptional && (
            <div className="mt-2 space-y-2">
              {optionalLines.map((line) => (
                <NetSheetLineRow key={line.id} line={line} salePrice={salePrice}
                  onChange={(patch) => updateLine(line.id, patch)} />
              ))}
            </div>
          )}
        </div>

        {/* Net proceeds */}
        <div className="rounded-xl bg-brand-navy/5 border border-brand-navy/10 px-4 py-3 space-y-1.5">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Sale Price</span>
            <span className="font-semibold text-brand-navy">+${salePrice.toLocaleString()}</span>
          </div>
          {liveLines.filter((l) => l.enabled && l.amount > 0).map((l) => (
            <div key={l.id} className="flex items-center justify-between text-xs">
              <span className="text-gray-500">{l.label}{l.isPct && l.pct ? ` (${l.pct}%)` : ''}</span>
              <span className="text-gray-600">-${l.amount.toLocaleString()}</span>
            </div>
          ))}
          <div className="border-t border-brand-navy/10 pt-2 flex items-center justify-between">
            <span className="text-sm font-bold text-brand-navy">Est. Net Proceeds</span>
            <span className={`text-xl font-black ${netProceeds >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              ${netProceeds.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 rounded-xl bg-brand-navy py-2.5 text-sm font-bold text-white hover:bg-brand-navy/90 disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={handleToggleReady}
            className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition-colors ${isReady
              ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              : 'bg-green-600 text-white hover:bg-green-700'}`}
          >
            {isReady ? 'Revert to Draft' : 'Ready to Send →'}
          </button>
        </div>
        {isReady && (
          <button
            onClick={() => printNetSheet(deal, liveLines, salePrice, netProceeds, closingDate || null)}
            className="w-full rounded-xl border border-brand-navy/20 py-2.5 text-sm font-semibold text-brand-navy hover:bg-brand-navy/5 transition-colors"
          >
            Download / Print PDF
          </button>
        )}
      </div>
    </div>
  );
}

function NetSheetLineRow({ line, salePrice, onChange }: {
  line: NetSheetLine;
  salePrice: number;
  onChange: (patch: Partial<NetSheetLine>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const equivPct = !line.isPct && salePrice > 0 ? ((line.amount / salePrice) * 100).toFixed(2) : null;
  const equivAmt = line.isPct && line.pct ? Math.round(salePrice * line.pct / 100) : null;

  return (
    <div className={`rounded-lg border transition-all ${line.enabled ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        {!line.required && (
          <button onClick={() => onChange({ enabled: !line.enabled })}
            className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded ${line.enabled ? 'bg-brand-navy' : 'border border-gray-300'}`}>
            {line.enabled && <CheckCircle2 size={10} className="text-white" />}
          </button>
        )}
        <span className="flex-1 text-xs text-gray-700 font-medium">{line.label}</span>
        {line.enabled && (
          <button onClick={() => setEditing((v) => !v)}
            className="text-[10px] text-gray-400 hover:text-brand-navy transition-colors font-semibold">
            {line.isPct ? `${line.pct}% = $${line.amount.toLocaleString()}` : `$${line.amount.toLocaleString()}`}
          </button>
        )}
      </div>
      {editing && line.enabled && line.editable && (
        <div className="px-3 pb-2.5 pt-0 space-y-2 border-t border-gray-100">
          {/* Pct / Fixed toggle for commission + transfer tax lines */}
          {(line.category === 'commission' || line.id === 'transfer_taxes') && (
            <div className="flex rounded-lg overflow-hidden border border-gray-200 text-[10px]">
              <button onClick={() => onChange({ isPct: true })}
                className={`flex-1 py-1 font-bold ${line.isPct ? 'bg-brand-navy text-white' : 'bg-white text-gray-500'}`}>
                %
              </button>
              <button onClick={() => onChange({ isPct: false })}
                className={`flex-1 py-1 font-bold ${!line.isPct ? 'bg-brand-navy text-white' : 'bg-white text-gray-500'}`}>
                $
              </button>
            </div>
          )}
          {line.isPct ? (
            <div className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5">
              <input type="number" step="0.25" value={line.pct ?? ''} min="0"
                onChange={(e) => onChange({ pct: parseFloat(e.target.value) || 0 })}
                className="flex-1 text-xs outline-none text-brand-navy" />
              <span className="text-xs text-gray-400">%{equivAmt !== null ? ` = $${equivAmt.toLocaleString()}` : ''}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5">
              <span className="text-xs text-gray-400">$</span>
              <input type="number" value={line.amount} min="0"
                onChange={(e) => onChange({ amount: parseInt(e.target.value) || 0 })}
                className="flex-1 text-xs outline-none text-brand-navy" />
              {equivPct && <span className="text-xs text-gray-400">≈ {equivPct}%</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Overview Tab ───────────────────────────────────────────────────────────

// ─── Confetti Celebration ────────────────────────────────────────────────────

function ConfettiCelebration({ onDismiss }: { onDismiss: () => void }) {
  const COLORS = ['#FFD700', '#00C49F', '#1a2d5a', '#FF6B6B', '#4ECDC4', '#A78BFA'];
  const pieces = useMemo(() =>
    Array.from({ length: 60 }, (_, i) => ({
      id: i,
      color: COLORS[i % COLORS.length],
      left: `${Math.random() * 100}%`,
      delay: `${Math.random() * 1.5}s`,
      duration: `${2.5 + Math.random() * 2}s`,
      size: `${6 + Math.random() * 8}px`,
      round: Math.random() > 0.5,
    })), []
  );

  useEffect(() => {
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="fixed inset-0 z-[9998] overflow-hidden">
      <style>{`
        @keyframes confetti-fall {
          0%   { transform: translateY(-20px) rotate(0deg);   opacity: 1; }
          100% { transform: translateY(105vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
      {/* Confetti pieces */}
      <div className="pointer-events-none absolute inset-0">
        {pieces.map((p) => (
          <div
            key={p.id}
            style={{
              position: 'absolute',
              left: p.left,
              top: 0,
              width: p.size,
              height: p.size,
              backgroundColor: p.color,
              borderRadius: p.round ? '50%' : '2px',
              animation: `confetti-fall ${p.duration} ${p.delay} ease-in forwards`,
            }}
          />
        ))}
      </div>
      {/* Backdrop + card */}
      <div className="absolute inset-0 bg-black/40 flex items-center justify-center px-4">
        <div className="rounded-2xl bg-white shadow-2xl px-8 py-8 text-center max-w-sm w-full">
          <div className="text-6xl mb-3">🎉</div>
          <h2 className="text-2xl font-black text-brand-navy">Congrats, Closing!</h2>
          <p className="mt-2 text-sm text-gray-500 leading-relaxed">
            The loan has funded. Another one in the books — great work!
          </p>
          <button
            onClick={onDismiss}
            className="mt-6 rounded-xl bg-brand-navy px-8 py-3 text-sm font-bold text-white hover:bg-brand-navy/90 transition-all active:scale-[0.98]"
          >
            Let's go! 🚀
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Loan Milestones Card ────────────────────────────────────────────────────

function LoanMilestonesCard({ deal, onRefresh }: { deal: Deal; onRefresh?: () => void }) {
  const [milestones, setMilestones] = useState<LoanMilestones | null>(
    deal.loanMilestones ?? null
  );
  const [showCelebration, setShowCelebration] = useState(false);
  const [ariveInput, setAriveInput] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState('');

  const lender = deal.vendors?.lender;
  const isArive = milestones?.source === 'arive';
  const isLinked = deal.flags.includes('mountain_mortgage');

  async function handleLink() {
    if (!ariveInput.trim()) return;
    setLinking(true);
    setLinkError('');
    try {
      await api.patch(`/deals/${deal.id}/arive`, { arive_loan_id: ariveInput.trim() });
      onRefresh?.();
    } catch {
      setLinkError('Failed to link — check the loan ID and try again.');
    } finally {
      setLinking(false);
    }
  }

  async function handleForceSync() {
    try {
      await api.post(`/deals/${deal.id}/arive/sync`, {});
      onRefresh?.();
    } catch { /* ignore */ }
  }

  if (!milestones && deal.type === 'buy') {
    return (
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-gray-400">Loan Milestones</h3>
        {isLinked ? (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <LinkIcon size={14} className="text-green-500" />
              <span>ARIVE loan linked — milestones syncing</span>
            </div>
            <button
              onClick={handleForceSync}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-50 transition-colors"
            >
              <RefreshCw size={12} /> Sync
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-400 leading-relaxed">
              Link an ARIVE loan ID to auto-sync Mountain Mortgage milestones. Leave blank for manual milestone tracking.
            </p>
            <div className="flex gap-2">
              <input
                value={ariveInput}
                onChange={(e) => setAriveInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLink()}
                placeholder="ARIVE loan ID"
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-navy/40 focus:ring-2 focus:ring-brand-navy/10"
              />
              <button
                onClick={handleLink}
                disabled={!ariveInput.trim() || linking}
                className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
              >
                {linking ? 'Linking…' : 'Link'}
              </button>
            </div>
            {linkError && <p className="text-xs text-red-500">{linkError}</p>}
          </div>
        )}
      </div>
    );
  }

  if (!milestones) return null;

  type BoolKey = 'loanSetup' | 'disclosuresOut' | 'disclosuresSignedSubmitted' | 'approvedWithConditions' | 'resubmittal' | 'clearToClose';

  function toggle(key: BoolKey) {
    if (isArive) return;
    setMilestones((prev) => prev ? { ...prev, [key]: !prev[key] } : prev);
  }

  function setAppraisal(val: LoanMilestones['appraisal']) {
    if (isArive) return;
    setMilestones((prev) => prev ? { ...prev, appraisal: val } : prev);
  }

  function markFunded() {
    setMilestones((prev) => prev ? { ...prev, funded: true } : prev);
    setShowCelebration(true);
  }

  const ORDERED_MILESTONES: { key: BoolKey; label: string }[] = [
    { key: 'loanSetup',                  label: 'Loan Setup' },
    { key: 'disclosuresOut',             label: 'Disclosures Out' },
    { key: 'disclosuresSignedSubmitted', label: 'Disclosures Signed & Submitted to Underwriting' },
    { key: 'approvedWithConditions',     label: 'Approved with Conditions' },
    { key: 'resubmittal',                label: 'Resubmittal' },
    { key: 'clearToClose',               label: 'Clear to Close' },
  ];

  const APPRAISAL_BADGE: Record<string, string> = {
    pending:   'bg-gray-100 text-gray-500',
    ordered:   'bg-blue-100 text-blue-700',
    scheduled: 'bg-amber-100 text-amber-700',
    complete:  'bg-green-100 text-green-700',
  };

  const completedCount = ORDERED_MILESTONES.filter(({ key }) => milestones[key]).length;

  return (
    <>
      {showCelebration && <ConfettiCelebration onDismiss={() => setShowCelebration(false)} />}

      <div className="rounded-xl bg-white p-5 shadow-sm">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">Loan Milestones</h3>
            <div className="mt-0.5 text-[11px] text-gray-400">{completedCount} of {ORDERED_MILESTONES.length} complete</div>
          </div>
          <div className="flex items-center gap-2">
            {milestones.funded && (
              <span className="rounded-full bg-green-500 px-2.5 py-0.5 text-[10px] font-black text-white tracking-wide uppercase">
                Funded ✓
              </span>
            )}
            {isArive ? (
              <button
                onClick={handleForceSync}
                title="Force sync from ARIVE"
                className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-bold text-green-700 hover:bg-green-200 transition-colors"
              >
                <RefreshCw size={9} /> ARIVE
              </button>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-700">
                <Pencil size={9} /> Manual
              </span>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-4 h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-green-400 transition-all duration-500"
            style={{ width: `${(completedCount / ORDERED_MILESTONES.length) * 100}%` }}
          />
        </div>

        {/* Ordered milestone list */}
        <div className="space-y-1 mb-4">
          {ORDERED_MILESTONES.map(({ key, label }, i) => {
            const done = milestones[key];
            const isNext = !done && ORDERED_MILESTONES.slice(0, i).every(({ key: k }) => milestones[k]);
            return (
              <button
                key={key}
                onClick={() => toggle(key)}
                disabled={isArive}
                className={[
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                  done ? 'bg-green-50' : isNext ? 'bg-blue-50/60' : 'bg-gray-50/60',
                  !isArive ? 'hover:opacity-80 cursor-pointer' : 'cursor-default',
                ].join(' ')}
              >
                <span className="flex-shrink-0">
                  {done
                    ? <CheckCircle2 size={16} className="text-green-500" />
                    : isNext
                    ? <Circle size={16} className="text-blue-400" />
                    : <Circle size={16} className="text-gray-300" />}
                </span>
                <span className={`flex-1 text-sm ${done ? 'text-green-700 font-medium' : isNext ? 'text-blue-700 font-medium' : 'text-gray-400'}`}>
                  {label}
                </span>
                {isNext && !isArive && (
                  <span className="flex-shrink-0 text-[10px] font-bold text-blue-500 uppercase tracking-wide">Up next</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Appraisal — separate, API-tracked */}
        <div className="border-t border-gray-50 pt-3 flex items-center justify-between gap-2">
          <div>
            <span className="text-xs font-semibold text-gray-500">Appraisal Status</span>
            <div className="text-[10px] text-gray-400 mt-0.5">Tracked via appraisal API</div>
          </div>
          <div className="flex items-center gap-2">
            {isArive ? (
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${APPRAISAL_BADGE[milestones.appraisal ?? 'pending']}`}>
                {milestones.appraisal ?? 'Pending'}
              </span>
            ) : (
              <select
                value={milestones.appraisal ?? 'pending'}
                onChange={(e) => setAppraisal(e.target.value as LoanMilestones['appraisal'])}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-brand-navy outline-none"
              >
                <option value="pending">Pending</option>
                <option value="ordered">Ordered</option>
                <option value="scheduled">Scheduled</option>
                <option value="complete">Complete</option>
              </select>
            )}
          </div>
        </div>

        {/* ARIVE raw tracker grid — only when synced from ARIVE */}
        {isArive && milestones.ariveTrackers && milestones.ariveTrackers.length > 0 && (
          <div className="mt-3 border-t border-gray-50 pt-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">ARIVE Trackers</p>
            <div className="grid grid-cols-2 gap-1.5">
              {milestones.ariveTrackers.map((t) => {
                const s = t.currentTrackerStatus?.status?.toLowerCase() ?? '';
                const isTrackerDone = s === 'completed';
                const isTrackerActive = s !== '' && s !== 'not_started' && !isTrackerDone;
                return (
                  <div
                    key={t.name}
                    className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[11px] ${
                      isTrackerDone ? 'bg-green-50' : isTrackerActive ? 'bg-blue-50' : 'bg-gray-50'
                    }`}
                  >
                    <span className={`font-medium ${isTrackerDone ? 'text-green-700' : isTrackerActive ? 'text-blue-700' : 'text-gray-400'}`}>
                      {t.name.replace(/_/g, ' ')}
                    </span>
                    <span className={`text-[9px] font-bold uppercase ${isTrackerDone ? 'text-green-600' : isTrackerActive ? 'text-blue-500' : 'text-gray-300'}`}>
                      {t.currentTrackerStatus?.status?.replace(/_/g, ' ') || '—'}
                    </span>
                  </div>
                );
              })}
            </div>
            {milestones.ariveLoanStatus && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[10px] text-gray-400">Loan Status:</span>
                <span className="text-[10px] font-bold text-brand-navy uppercase tracking-wide">
                  {milestones.ariveLoanStatus.replace(/_/g, ' ')}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Mark as Funded — manual mode only, shown when CTC is done */}
        {!isArive && milestones.clearToClose && !milestones.funded && (
          <button
            onClick={markFunded}
            className="mt-3 w-full rounded-xl bg-green-500 py-2.5 text-sm font-bold text-white hover:bg-green-600 transition-colors"
          >
            🎉 Mark as Funded
          </button>
        )}
      </div>
    </>
  );
}

// ─── Property Tracking Card (agent side) ────────────────────────────────────

const AGENT_STATUS_CONFIG: Record<PropertyStatus, { label: string; style: string }> = {
  interested:       { label: 'Interested',       style: 'bg-blue-100 text-blue-700' },
  toured:           { label: 'Toured',           style: 'bg-purple-100 text-purple-700' },
  not_for_me:       { label: 'Not for me',       style: 'bg-gray-100 text-gray-400' },
  offer_submitted:  { label: 'Offer Submitted',  style: 'bg-green-100 text-green-700' },
};

function AgentPropertyRow({ prop, onRemove, onUpdateAgentNote }: { prop: TrackedProperty; onRemove: () => void; onUpdateAgentNote: (id: string, note: string) => void }) {
  const [imgErr, setImgErr] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(prop.agentPrivateNote ?? '');
  const cfg = AGENT_STATUS_CONFIG[prop.status];

  function saveNote() {
    onUpdateAgentNote(prop.id, noteDraft.trim());
    setNoteOpen(false);
  }

  return (
    <div className={`rounded-xl border overflow-hidden ${prop.status === 'not_for_me' ? 'opacity-50 border-gray-100' : prop.offerRequested ? 'border-amber-300' : 'border-gray-100'}`}>
      {/* Offer request alert */}
      {prop.offerRequested && (
        <div className="flex items-center gap-2 bg-amber-50 border-b border-amber-200 px-3 py-2">
          <Star size={13} className="text-amber-500 flex-shrink-0" />
          <p className="text-xs font-bold text-amber-800">
            Buyer wants to make an offer on {prop.address}
          </p>
        </div>
      )}

      <div className="flex items-start gap-3 bg-gray-50 p-3">
        {/* Thumbnail */}
        <div className="h-14 w-14 flex-shrink-0 rounded-lg overflow-hidden bg-gray-200 flex items-center justify-center">
          {prop.thumbnailUrl && !imgErr ? (
            <img src={prop.thumbnailUrl} alt="" className="h-full w-full object-cover" onError={() => setImgErr(true)} />
          ) : (
            <Home size={20} className="text-gray-400" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-brand-navy truncate">{prop.address}</p>
            {prop.addedBy === 'agent' && (
              <span className="flex-shrink-0 rounded-full bg-brand-navy/10 px-1.5 py-0.5 text-[9px] font-bold text-brand-navy uppercase tracking-wide">You</span>
            )}
          </div>
          <p className="text-xs text-gray-400 truncate">{prop.city}{prop.state ? `, ${prop.state}` : ''}{prop.price > 0 ? ` · $${prop.price.toLocaleString()}` : ''}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cfg.style}`}>{cfg.label}</span>
            {(prop.beds > 0 || prop.sqft > 0) && (
              <span className="text-[10px] text-gray-400">{prop.beds > 0 ? `${prop.beds}bd · ${prop.baths}ba` : ''}{prop.sqft > 0 ? ` · ${prop.sqft.toLocaleString()} sqft` : ''}</span>
            )}
          </div>

          {/* Agent's push note */}
          {prop.agentNote && (
            <p className="mt-1 text-[10px] text-amber-700 italic">"{prop.agentNote}"</p>
          )}

          {/* Buyer's thoughts */}
          {prop.buyerNote && (
            <div className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-purple-50 border border-purple-100 px-2 py-1.5">
              <MessageSquare size={10} className="text-purple-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[9px] font-bold text-purple-400 uppercase tracking-wide mb-0.5">Buyer's thoughts</p>
                <p className="text-[11px] text-purple-700 leading-snug">{prop.buyerNote}</p>
              </div>
            </div>
          )}

          {/* Agent private note */}
          {!noteOpen && (
            <button
              onClick={() => setNoteOpen(true)}
              className="mt-1.5 flex items-center gap-1 text-[10px] text-gray-400 hover:text-brand-navy transition-colors"
            >
              <Pencil size={9} />
              {prop.agentPrivateNote ? 'Edit private note' : 'Add private note'}
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
          {prop.sourceUrl && (
            <a href={prop.sourceUrl} target="_blank" rel="noopener noreferrer"
              className="text-gray-400 hover:text-brand-navy transition-colors">
              <ExternalLink size={13} />
            </a>
          )}
          <button onClick={onRemove} className="text-gray-300 hover:text-red-400 transition-colors">
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Private note (shown) */}
      {prop.agentPrivateNote && !noteOpen && (
        <div className="border-t border-gray-100 bg-white px-3 py-2 flex items-start gap-1.5">
          <Lock size={9} className="text-gray-300 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-gray-500 italic leading-snug">{prop.agentPrivateNote}</p>
        </div>
      )}

      {/* Private note editor */}
      {noteOpen && (
        <div className="border-t border-gray-100 bg-white px-3 py-3 space-y-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide flex items-center gap-1">
            <Lock size={9} /> Private note (only you see this)
          </p>
          <textarea
            autoFocus
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Your internal notes on this property…"
            rows={2}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-700 outline-none focus:border-brand-navy/30 resize-none"
          />
          <div className="flex gap-2">
            <button onClick={saveNote}
              className="flex-1 rounded-lg bg-brand-navy py-1.5 text-xs font-bold text-white hover:bg-brand-navy/90 transition-colors">
              Save
            </button>
            <button onClick={() => { setNoteOpen(false); setNoteDraft(prop.agentPrivateNote ?? ''); }}
              className="rounded-lg border border-gray-200 px-3 text-xs text-gray-500 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PropertyTrackingCard({ deal }: { deal: Deal }) {
  const { properties, addProperty, removeProperty, updateAgentNote } = useProperties(deal.id);

  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState('');
  const [address, setAddress] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');

  async function handleAdd() {
    const trimAddr = address.trim();
    if (!trimAddr) return;
    const parts = trimAddr.split(',').map((s) => s.trim());
    await addProperty({
      dealId: deal.id,
      address: parts[0] ?? trimAddr,
      city: parts[1] ?? '',
      state: parts[2] ?? '',
      price: parseInt(price.replace(/\D/g, ''), 10) || 0,
      beds: 0,
      baths: 0,
      sqft: 0,
      thumbnailUrl: '',
      sourceUrl: url.trim(),
      status: 'interested',
      addedBy: 'agent',
      agentNote: note.trim() || undefined,
    }).catch(() => {});
    setUrl(''); setAddress(''); setPrice(''); setNote('');
    setShowForm(false);
  }

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">Property Tracker</h3>
          <p className="text-[11px] text-gray-400 mt-0.5">{properties.length} propert{properties.length === 1 ? 'y' : 'ies'} tracked</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-navy/90 transition-colors"
        >
          <Plus size={13} />
          Push to buyer
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="mb-4 rounded-xl border border-brand-navy/10 bg-blue-50/40 p-4 space-y-2.5">
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Listing URL (MLS / Zillow / Realtor)</label>
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
              <LinkIcon size={13} className="text-gray-400 flex-shrink-0" />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.zillow.com/homedetails/..."
                className="flex-1 text-sm outline-none bg-transparent text-brand-navy placeholder:text-gray-300"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Address <span className="text-red-400">*</span></label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St, Birmingham, AL"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none text-brand-navy placeholder:text-gray-300"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">List Price</label>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="$350,000"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none text-brand-navy placeholder:text-gray-300"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Note to buyer (optional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Great neighborhood, matches your wishlist..."
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none text-brand-navy placeholder:text-gray-300"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleAdd}
              disabled={!address.trim()}
              className="flex-1 rounded-lg bg-brand-navy py-2 text-sm font-bold text-white disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
            >
              Push property →
            </button>
            <button
              onClick={() => { setShowForm(false); setUrl(''); setAddress(''); setPrice(''); setNote(''); }}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Property list */}
      {properties.length > 0 ? (
        <div className="space-y-2">
          {properties.map((p) => (
            <AgentPropertyRow key={p.id} prop={p} onRemove={() => removeProperty(p.id)} onUpdateAgentNote={updateAgentNote} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Home size={28} className="text-gray-200 mb-2" />
          <p className="text-sm font-medium text-gray-400">No properties tracked yet</p>
          <p className="text-xs text-gray-300 mt-0.5">Push a listing to start your buyer's property list</p>
        </div>
      )}
    </div>
  );
}

function CommissionRateField({ deal, onUpdated }: { deal: Deal; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false);
  const [pct, setPct] = useState(String(deal.commissionPct ?? 3));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    const val = parseFloat(pct);
    if (isNaN(val) || val <= 0 || val > 20) return;
    setSaving(true);
    try {
      await api.patch(`/deals/${deal.id}/commission`, { commission_pct: val });
      setEditing(false);
      setSaved(true);
      onUpdated();
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // keep editing open
    } finally {
      setSaving(false);
    }
  }

  const price = deal.property.price ?? 0;
  const previewCommission = Math.round(price * (parseFloat(pct) / 100));

  return (
    <>
      <div>
        <dt className="text-gray-400 text-xs flex items-center gap-1">
          Est. Commission
          {saved && <span className="text-green-600 text-[10px] font-semibold">Saved</span>}
        </dt>
        <dd className="font-semibold text-green-700 mt-0.5">
          {editing ? (
            <div className="flex items-center gap-1.5 mt-0.5">
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="20"
                value={pct}
                onChange={(e) => setPct(e.target.value)}
                className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-xs text-brand-navy focus:outline-none focus:border-brand-navy"
                autoFocus
              />
              <span className="text-xs text-gray-400">%</span>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded bg-brand-navy px-2 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50"
              >
                {saving ? '…' : 'Save'}
              </button>
              <button
                onClick={() => { setEditing(false); setPct(String(deal.commissionPct ?? 3)); }}
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-gray-400 hover:text-gray-600"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="group flex items-center gap-1 hover:text-green-800 transition-colors"
              title="Edit commission rate"
            >
              ${deal.estimatedCommission.toLocaleString()}
              <span className="text-[10px] font-normal text-gray-400 group-hover:text-green-700">
                ({deal.commissionPct ?? 3}%)
              </span>
              <Pencil size={10} className="text-gray-300 group-hover:text-green-600 transition-colors" />
            </button>
          )}
        </dd>
      </div>
      {editing && !isNaN(parseFloat(pct)) && price > 0 && (
        <div>
          <dt className="text-gray-400 text-xs">Preview at {pct}%</dt>
          <dd className="font-semibold text-green-600 mt-0.5">${previewCommission.toLocaleString()}</dd>
        </div>
      )}
    </>
  );
}

function InternalNotesCard({ deal }: { deal: Deal }) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(deal.notes ?? '');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await api.patch(`/deals/${deal.id}/notes`, { notes });
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Keep editing open on failure
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-50">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">Internal Notes</h3>
          <span className="flex items-center gap-1 rounded-full bg-brand-navy/8 px-2 py-0.5 text-[10px] font-semibold text-brand-navy/50">
            <X size={9} strokeWidth={3} className="rotate-45" />
            Not visible to clients
          </span>
        </div>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <Pencil size={11} /> Edit
          </button>
        )}
        {saved && (
          <span className="flex items-center gap-1 text-xs font-semibold text-green-600">
            <CheckCircle2 size={12} /> Saved
          </span>
        )}
      </div>
      <div className="px-5 py-4">
        {editing ? (
          <div className="space-y-3">
            <textarea
              autoFocus
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Add internal notes about this deal — visible only to agents, TCs, and admins..."
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-brand-navy placeholder-gray-300 outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10 resize-none leading-relaxed"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setEditing(false)}
                className="flex-1 rounded-xl border border-gray-200 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 rounded-xl bg-brand-navy py-2 text-sm font-bold text-white hover:bg-brand-navy/90 transition-colors disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save Notes'}
              </button>
            </div>
          </div>
        ) : (
          <p
            onClick={() => setEditing(true)}
            className={`text-sm leading-relaxed cursor-text rounded-lg px-1 py-0.5 hover:bg-gray-50 transition-colors ${
              notes ? 'text-gray-700' : 'text-gray-300 italic'
            }`}
          >
            {notes || 'No notes yet — click to add'}
          </p>
        )}
      </div>
    </div>
  );
}

function FastPassCard({ deal }: { deal: Deal }) {
  const navigate = useNavigate();
  const fp = deal.fastPass;

  const STATUS_STYLES: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    pending_payment: 'bg-amber-100 text-amber-700',
    complete: 'bg-gray-100 text-gray-500',
  };

  if (fp) {
    return (
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-100">
              <Zap size={16} className="text-green-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-brand-navy">Fast Pass</h3>
              <p className="text-[11px] text-gray-400">
                Enrolled {new Date(fp.enrolledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${STATUS_STYLES[fp.status] ?? 'bg-gray-100 text-gray-500'}`}>
              {fp.status === 'pending_payment' ? 'Pending payment' : fp.status}
            </span>
            <span className="text-xs text-gray-400">${fp.totalPaid.toLocaleString()}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 border-dashed border-green-200 bg-green-50/40 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-green-100">
          <Zap size={18} className="text-green-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-brand-navy">Fast Pass</h3>
          <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">
            White-glove concierge from pre-approval to move-in. 10-day close track + Mountain Mortgage 2% refi credit.
          </p>
        </div>
      </div>
      <button
        onClick={() => navigate(`/fast-pass?dealId=${deal.id}`)}
        className="mt-3 w-full rounded-lg bg-green-500 py-2.5 text-sm font-bold text-white hover:bg-green-600 transition-colors"
      >
        Enroll in Fast Pass
      </button>
    </div>
  );
}

function SmoothExitCard({ deal }: { deal: Deal }) {
  const navigate = useNavigate();
  const se = deal.smoothExit;

  const STATUS_STYLES: Record<string, string> = {
    active: 'bg-purple-100 text-purple-700',
    pending: 'bg-amber-100 text-amber-700',
    complete: 'bg-gray-100 text-gray-500',
  };

  if (se) {
    return (
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100">
              <LogOut size={16} className="text-purple-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-brand-navy">Smooth Exit</h3>
              <p className="text-[11px] text-gray-400">
                Enrolled {new Date(se.enrolledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${STATUS_STYLES[se.status] ?? 'bg-gray-100 text-gray-500'}`}>
              {se.status}
            </span>
            <span className="text-xs text-gray-400">${se.fee.toLocaleString()} · 1%</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 border-dashed border-purple-200 bg-purple-50/40 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-purple-100">
          <LogOut size={18} className="text-purple-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-brand-navy">Smooth Exit</h3>
          <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">
            Seller concierge: move-out coordination, repair bid management, disclosure tracking, and title support. 1% of sale price at closing.
          </p>
        </div>
      </div>
      <button
        onClick={() => navigate(`/smooth-exit?dealId=${deal.id}`)}
        className="mt-3 w-full rounded-lg bg-purple-600 py-2.5 text-sm font-bold text-white hover:bg-purple-700 transition-colors"
      >
        Enroll in Smooth Exit
      </button>
    </div>
  );
}

function OverviewTab({ deal, tasks, onRefresh }: { deal: Deal; tasks: Task[]; onRefresh?: () => void }) {
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const { participants } = useParticipants(deal.id);
  const clientParticipant = participants.find((p) => p.role === 'buyer' || p.role === 'seller');

  return (
    <div className="space-y-4">
      {/* Loan Milestones + ARIVE Linker */}
      <LoanMilestonesCard deal={deal} onRefresh={onRefresh} />

      {/* Deal Details */}
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-gray-400">Deal Details</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-gray-400 text-xs">Type</dt>
            <dd className="font-semibold text-brand-navy capitalize mt-0.5">{deal.type === 'buy' ? 'Purchase' : 'Listing'}</dd>
          </div>
          <div>
            <dt className="text-gray-400 text-xs">Price</dt>
            <dd className="font-semibold text-brand-navy mt-0.5">${deal.property.price.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-gray-400 text-xs">Stage</dt>
            <dd className="font-semibold text-brand-navy mt-0.5">{STAGE_LABELS[deal.stage]}</dd>
          </div>
          <div>
            <dt className="text-gray-400 text-xs">Days in Stage</dt>
            <dd className="font-semibold text-brand-navy mt-0.5">{deal.timeline.daysInStage} days</dd>
          </div>
          {deal.timeline.closingDate && (
            <div>
              <dt className="text-gray-400 text-xs">Closing Date</dt>
              <dd className="font-semibold text-brand-navy mt-0.5">{deal.timeline.closingDate}</dd>
            </div>
          )}
          <CommissionRateField deal={deal} onUpdated={onRefresh ?? (() => {})} />
          <div>
            <dt className="text-gray-400 text-xs">Created</dt>
            <dd className="font-semibold text-brand-navy mt-0.5">
              {new Date(deal.timeline.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </dd>
          </div>
        </dl>
      </div>

      {/* Onboarding Info */}
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-gray-400">Onboarding Info</h3>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-gray-400 text-xs mb-0.5">Client</dt>
            <dd className="font-semibold text-brand-navy">{deal.clientName}</dd>
          </div>
          {clientParticipant && (
            <>
              {clientParticipant.phone && (
                <div>
                  <dt className="text-gray-400 text-xs mb-0.5">Phone</dt>
                  <dd>
                    <a href={`tel:${clientParticipant.phone}`} className="font-semibold text-brand-navy hover:text-blue-600 transition-colors">
                      {clientParticipant.phone}
                    </a>
                  </dd>
                </div>
              )}
              {clientParticipant.email && (
                <div>
                  <dt className="text-gray-400 text-xs mb-0.5">Email</dt>
                  <dd>
                    <a href={`mailto:${clientParticipant.email}`} className="font-semibold text-brand-navy hover:text-blue-600 transition-colors break-all">
                      {clientParticipant.email}
                    </a>
                  </dd>
                </div>
              )}
            </>
          )}
          {deal.flags.length > 0 && (
            <div>
              <dt className="text-gray-400 text-xs mb-1">Flags</dt>
              <dd className="flex flex-wrap gap-1.5">
                {deal.flags.map((flag) => (
                  <span key={flag} className="rounded-full bg-brand-navy/10 px-2.5 py-0.5 text-xs font-medium text-brand-navy">
                    {FLAG_LABELS[flag] ?? flag}
                  </span>
                ))}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-gray-400 text-xs mb-0.5">Task Progress</dt>
            <dd className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full bg-green-400 rounded-full transition-all"
                  style={{ width: tasks.length ? `${(completedCount / tasks.length) * 100}%` : '0%' }}
                />
              </div>
              <span className="text-xs text-gray-400">{completedCount}/{tasks.length}</span>
            </dd>
          </div>
        </dl>
      </div>

      {/* Property Tracker — buy deals only */}
      {deal.type === 'buy' && <PropertyTrackingCard deal={deal} />}

      {/* Seller-specific tools */}
      {deal.type === 'sell' && (
        <>
          {/* Showing Availability */}
          <SellerShowingAvailabilityCard dealId={deal.id} />

          {/* Offer Management */}
          <SellerOffersCard dealId={deal.id} />

          {/* Buyer Status — under_contract and beyond */}
          {['under_contract', 'pre_close', 'closing', 'post_close'].includes(deal.stage) && (
            <SellerBuyerStatusCard dealId={deal.id} />
          )}

          {/* Net Sheet — pre_close and post_close */}
          {['pre_close', 'post_close'].includes(deal.stage) && (
            <SellerNetSheetCard deal={deal} />
          )}
        </>
      )}

      {/* Fast Pass — buy deals only */}
      {deal.type === 'buy' && <FastPassCard deal={deal} />}

      {/* Smooth Exit — sell deals only */}
      {deal.type === 'sell' && <SmoothExitCard deal={deal} />}

      {/* Internal Notes */}
      <InternalNotesCard deal={deal} />

      {/* Closing Fee — shown at post_close */}
      {deal.stage === 'post_close' && <ClosingFeeCard deal={deal} />}
    </div>
  );
}

// ─── Closing Fee Card ────────────────────────────────────────────────────────

function ClosingFeeCard({ deal }: { deal: Deal }) {
  const [loading, setLoading] = useState(false);
  const feeStatus = deal.feeStatus ?? 'unpaid';
  const amount = ((deal.feeAmountCents ?? 7500) / 100).toFixed(2);

  async function handlePay() {
    setLoading(true);
    try {
      const res = await api.post<{ checkout_url: string }>(`/deals/${deal.id}/fee/checkout`, {});
      window.location.href = res.checkout_url;
    } catch {
      setLoading(false);
    }
  }

  const STATUS_STYLES: Record<string, string> = {
    paid:    'bg-green-100 text-green-700',
    waived:  'bg-gray-100 text-gray-500',
    pending: 'bg-amber-100 text-amber-700',
    unpaid:  'bg-red-50 text-red-600',
  };

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">Closing Fee</h3>
          <p className="mt-1 text-2xl font-bold text-brand-navy">${amount}</p>
          {feeStatus === 'paid' && deal.feePaidAt && (
            <p className="text-[11px] text-gray-400 mt-0.5">
              Paid {new Date(deal.feePaidAt).toLocaleDateString()}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${STATUS_STYLES[feeStatus] ?? STATUS_STYLES.unpaid}`}>
            {feeStatus}
          </span>
          {(feeStatus === 'unpaid' || feeStatus === 'pending') && (
            <button
              onClick={handlePay}
              disabled={loading}
              className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-bold text-brand-navy hover:bg-brand-gold-dark transition-colors disabled:opacity-60"
            >
              {loading ? 'Redirecting…' : 'Pay Now'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tasks Tab ──────────────────────────────────────────────────────────────

const STATUS_SORT_ORDER: Record<string, number> = {
  overdue: 0, in_progress: 1, blocked: 2, pending: 3, completed: 4,
};

function TasksTab({ deal, tasks, onTasksChange }: { deal: Deal; tasks: Task[]; onTasksChange: () => void }) {
  const { can } = usePermission();
  const canAssign = can(PERMISSIONS.TASK_ASSIGN_ANY);

  const [completedIds, setCompletedIds] = useState<Set<string>>(
    new Set(tasks.filter((t) => t.status === 'completed').map((t) => t.id))
  );
  const [assigningTaskId, setAssigningTaskId] = useState<string | null>(null);
  const { reassign: storeReassign, effectiveAssignee } = useTaskStore();

  async function toggleComplete(id: string) {
    const willBeCompleted = !completedIds.has(id);
    const newStatus = willBeCompleted ? 'completed' : 'pending';
    setCompletedIds((prev) => {
      const next = new Set(prev);
      if (willBeCompleted) next.add(id); else next.delete(id);
      return next;
    });
    try {
      await patchTaskStatus(id, newStatus);
    } catch {
      setCompletedIds((prev) => {
        const next = new Set(prev);
        if (willBeCompleted) next.delete(id); else next.add(id);
        return next;
      });
    }
  }

  function reassign(taskId: string, assignee: Task['assignedTo']) {
    storeReassign(taskId, assignee);
    setAssigningTaskId(null);
  }

  function effectiveStatus(t: Task) {
    return completedIds.has(t.id) ? 'completed' : t.status;
  }

  function sortByStatus(a: Task, b: Task) {
    return (STATUS_SORT_ORDER[effectiveStatus(a)] ?? 5) - (STATUS_SORT_ORDER[effectiveStatus(b)] ?? 5);
  }

  const agentTasks   = tasks.filter((t) => effectiveAssignee(t) === 'agent').sort(sortByStatus);
  const clientTasks  = tasks.filter((t) => effectiveAssignee(t) === 'buyer' || effectiveAssignee(t) === 'seller').sort(sortByStatus);
  const supportTasks = tasks.filter((t) => effectiveAssignee(t) === 'tc' || effectiveAssignee(t) === 'third_party' || effectiveAssignee(t) === 'admin').sort(sortByStatus);

  const STATUS_PILL: Record<string, string> = {
    completed:   'bg-green-100 text-green-700',
    in_progress: 'bg-blue-100 text-blue-700',
    overdue:     'bg-red-100 text-red-700',
    pending:     'bg-gray-100 text-gray-500',
    blocked:     'bg-orange-100 text-orange-700',
  };

  const ASSIGNEE_OPTIONS: { value: Task['assignedTo']; label: string; color: string }[] = [
    { value: 'agent',       label: 'Agent (Me)',      color: 'text-blue-700' },
    { value: 'buyer',       label: 'Buyer (Client)',  color: 'text-green-700' },
    { value: 'seller',      label: 'Seller (Client)', color: 'text-purple-700' },
    { value: 'tc',          label: 'TC',              color: 'text-amber-700' },
    { value: 'third_party', label: 'Third Party',     color: 'text-gray-600' },
  ];

  const ASSIGNEE_LABEL: Record<string, string> = {
    agent: 'Agent', buyer: 'Buyer', seller: 'Seller', tc: 'TC', third_party: 'Third Party', admin: 'Admin',
  };

  function TaskItem({ task }: { task: Task }) {
    const isDone = completedIds.has(task.id);
    const status = effectiveStatus(task);
    const assignee = effectiveAssignee(task);
    const isAssigning = assigningTaskId === task.id;

    return (
      <div className={`flex items-start gap-3 rounded-lg px-3 py-3 transition-colors group ${isDone ? 'opacity-60' : 'hover:bg-brand-bg'}`}>
        <button
          onClick={() => toggleComplete(task.id)}
          className={`mt-0.5 flex-shrink-0 rounded-full transition-all ${
            isDone ? 'text-green-500 hover:text-gray-300' : 'text-gray-300 hover:text-green-400'
          }`}
          title={isDone ? 'Mark incomplete' : 'Mark complete'}
        >
          {isDone
            ? <CheckCircle2 size={16} className="text-green-500" />
            : TASK_STATUS_ICON[status]}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <span className={`text-sm font-medium transition-colors ${isDone ? 'line-through text-gray-400' : 'text-brand-navy'}`}>
              {task.title}
            </span>
            {task.source === 'ai' && !isDone && (
              <span className="flex items-center gap-0.5 rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-600">
                <Bot size={10} /> AI
              </span>
            )}
          </div>
          {task.description && !isDone && (
            <p className="mt-0.5 text-xs text-gray-400 leading-relaxed">{task.description}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_PILL[status]}`}>
              {status.replace('_', ' ')}
            </span>
            {task.priority === 'high' && !isDone && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-500 uppercase">High Priority</span>
            )}
            {task.dueDate && !isDone && (
              <span className="flex items-center gap-0.5 text-[11px] text-gray-400">
                <Calendar size={10} /> {task.dueDate}
              </span>
            )}

            {/* Assign button — only for agent/admin */}
            {canAssign && !isDone && (
              <div className="relative ml-auto">
                <button
                  onClick={() => setAssigningTaskId(isAssigning ? null : task.id)}
                  className={[
                    'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors',
                    isAssigning
                      ? 'border-brand-navy bg-brand-navy text-white'
                      : 'border-gray-200 bg-white text-gray-500 hover:border-brand-navy hover:text-brand-navy',
                  ].join(' ')}
                >
                  <Users size={10} />
                  {ASSIGNEE_LABEL[assignee] ?? assignee}
                  <ChevronDown size={9} />
                </button>

                {isAssigning && (
                  <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-xl border border-gray-100 bg-white shadow-xl overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-50">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Assign to</p>
                    </div>
                    {ASSIGNEE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => reassign(task.id, opt.value)}
                        className={[
                          'flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs transition-colors hover:bg-brand-bg',
                          assignee === opt.value ? 'font-bold bg-brand-bg' : 'font-medium',
                          opt.color,
                        ].join(' ')}
                      >
                        {assignee === opt.value && <CheckCircle2 size={11} className="flex-shrink-0" />}
                        {assignee !== opt.value && <span className="w-[11px]" />}
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function OwnerSection({
    label,
    sublabel,
    icon: Icon,
    tasks,
  }: {
    label: string;
    sublabel: string;
    icon: React.ElementType;
    tasks: Task[];
  }) {
    const doneCount = tasks.filter((t) => completedIds.has(t.id)).length;
    const total = tasks.length;
    if (total === 0) return null;
    const allSectionDone = doneCount === total;
    return (
      <div className="rounded-xl bg-white shadow-sm overflow-hidden">
        {/* Section header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-brand-navy border-b border-brand-navy">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10">
            <Icon size={14} className="text-brand-gold" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold leading-none text-white">{label}</div>
            <div className="text-[11px] mt-0.5 text-white/50">{sublabel}</div>
          </div>
          <div className="flex items-center gap-1.5">
            {allSectionDone && <CheckCircle2 size={13} className="text-green-400" />}
            <span className="text-xs font-bold text-brand-gold">{doneCount}/{total}</span>
          </div>
        </div>
        <div className="divide-y divide-gray-50">
          {tasks.map((t) => <TaskItem key={t.id} task={t} />)}
        </div>
      </div>
    );
  }

  const allDone = tasks.length > 0 && completedIds.size === tasks.length;

  return (
    <div className="space-y-3">
      {allDone ? (
        <div className="rounded-xl bg-white shadow-sm flex flex-col items-center py-10 gap-2">
          <CheckCircle2 size={36} className="text-green-400" />
          <p className="text-sm font-semibold text-green-700">All tasks complete</p>
          <p className="text-xs text-gray-400">Great work on this deal.</p>
        </div>
      ) : (
        <>
          <OwnerSection
            label="Your Tasks"
            sublabel="Action required from you"
            icon={CheckSquare}
            tasks={agentTasks}
          />
          <OwnerSection
            label="Client's Tasks"
            sublabel={`${deal.clientName} needs to complete these`}
            icon={Users}
            tasks={clientTasks}
          />
          <OwnerSection
            label="TC / Third Party"
            sublabel="Handled by your team or vendors"
            icon={Building2}
            tasks={supportTasks}
          />
        </>
      )}
    </div>
  );
}

// ─── Messages Tab ────────────────────────────────────────────────────────────

const AVATAR_COLOR: Record<string, string> = {
  agent:  'bg-brand-navy',
  buyer:  'bg-green-500',
  seller: 'bg-purple-500',
  tc:     'bg-amber-500',
  admin:  'bg-red-500',
};

function MessagesTab({ deal }: { deal: Deal }) {
  const { can } = usePermission();
  const canSeeInternal = can(PERMISSIONS.MESSAGE_VIEW) && can(PERMISSIONS.MESSAGE_PIN);
  const [channel, setChannel] = useState<MessageChannel>('client_thread');
  const { messages, loading, refresh } = useMessages(deal.id, channel);
  const activeUser = useAuthStore((s) => s.activeUser);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSend() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await postMessage(deal.id, channel, body);
      setDraft('');
      await refresh();
    } catch {
      // leave draft intact so the user can retry
    } finally {
      setSending(false);
    }
  }

  function Thread() {
    if (loading && messages.length === 0) {
      return (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={16} className="animate-spin text-gray-300" />
        </div>
      );
    }
    return (
      <div className="p-4 space-y-4">
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-400">No messages yet.</p>
        )}
        {messages.map((msg) => {
          const isMe = msg.senderId === activeUser?.id;
          const avatarColor = AVATAR_COLOR[msg.senderRole] ?? 'bg-gray-400';
          return (
            <div key={msg.id} className={`flex gap-3 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-white text-xs font-bold ${avatarColor}`}>
                {msg.senderName.charAt(0)}
              </div>
              <div className={`flex-1 max-w-[80%] ${isMe ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                <div className={`flex items-center gap-2 text-xs text-gray-400 ${isMe ? 'flex-row-reverse' : ''}`}>
                  <span className="font-medium text-gray-600">{msg.senderName}</span>
                  {msg.senderRole === 'tc' && (
                    <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">TC</span>
                  )}
                  {msg.isAiDraft && (
                    <span className="flex items-center gap-0.5 rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-600">
                      <Bot size={9} /> AI draft
                    </span>
                  )}
                  <span>{formatTimestamp(msg.timestamp)}</span>
                </div>
                <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  isMe
                    ? 'bg-brand-navy text-white rounded-tr-sm'
                    : channel === 'internal'
                    ? 'bg-amber-50 text-gray-800 rounded-tl-sm border border-amber-100'
                    : 'bg-gray-100 text-gray-800 rounded-tl-sm'
                }`}>
                  {msg.content}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white shadow-sm overflow-hidden">
      {/* Channel switcher */}
      <div className="flex border-b border-gray-100">
        <button
          onClick={() => setChannel('client_thread')}
          className={[
            'flex-1 py-3 text-xs font-bold transition-colors',
            channel === 'client_thread'
              ? 'text-brand-navy border-b-2 border-brand-navy bg-white'
              : 'text-gray-400 hover:text-gray-600',
          ].join(' ')}
        >
          <div className="flex items-center justify-center gap-1.5">
            <Users size={12} />
            Client Thread
          </div>
          <div className="text-[10px] font-normal mt-0.5 opacity-70">Agent · Client · TC</div>
        </button>

        {canSeeInternal && (
          <button
            onClick={() => setChannel('internal')}
            className={[
              'flex-1 py-3 text-xs font-bold transition-colors',
              channel === 'internal'
                ? 'text-amber-700 border-b-2 border-amber-500 bg-white'
                : 'text-gray-400 hover:text-gray-600',
            ].join(' ')}
          >
            <div className="flex items-center justify-center gap-1.5">
              <MessageSquare size={12} />
              Internal
            </div>
            <div className="text-[10px] font-normal mt-0.5 opacity-70">Agent + TC only</div>
          </button>
        )}
      </div>

      {channel === 'internal' && (
        <div className="flex items-center gap-2 bg-amber-50 border-b border-amber-100 px-4 py-2">
          <AlertTriangle size={12} className="text-amber-600 flex-shrink-0" />
          <p className="text-[11px] text-amber-700 font-medium">Not visible to clients</p>
        </div>
      )}

      <Thread />

      {/* Compose area */}
      <div className="border-t px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={channel === 'internal' ? 'Message your TC...' : 'Message the client...'}
            className="flex-1 rounded-full border border-gray-200 bg-brand-bg px-4 py-2 text-sm outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10 disabled:opacity-50"
            disabled={sending}
          />
          <button
            onClick={handleSend}
            disabled={!draft.trim() || sending}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-brand-navy text-white hover:bg-brand-navy/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Documents Tab ───────────────────────────────────────────────────────────

const STAGE_GATE: Partial<Record<DealStage, { name: string; note: string }>> = {
  active_search: { name: 'Buyer Agency Agreement', note: 'Required before showing properties' },
  under_contract: { name: 'Purchase Agreement', note: 'Must be signed to enter contract' },
  closing: { name: 'Wire / Cashier\'s Check Confirmation', note: 'Confirm funds before closing' },
};

const DOC_STATUS_BADGE: Record<string, string> = {
  signed: 'bg-green-100 text-green-700',
  pending_review: 'bg-amber-100 text-amber-700',
  pending_signature: 'bg-blue-100 text-blue-700',
  requested: 'bg-gray-100 text-gray-600',
  missing: 'bg-red-50 text-red-500',
};

const DOC_STATUS_LABELS: Record<string, string> = {
  signed: 'Signed',
  pending_review: 'Pending Review',
  pending_signature: 'Awaiting Signature',
  requested: 'Requested',
  missing: 'Missing',
};

// ── Upload Modal ──────────────────────────────────────────────────────────────

const DOC_TYPE_OPTIONS = [
  'Buyer Agency Agreement',
  'Purchase Agreement',
  'Listing Agreement',
  'Seller Disclosures',
  'Inspection Report',
  'Repair Addendum',
  'Wire Instructions',
  'ARIVE Disclosures',
  'Proof of Funds',
  'Appraisal Report',
  'Title Commitment',
  'HOA Documents',
  'Other',
];

function UploadDocModal({
  dealId,
  onClose,
  onUploaded,
}: {
  dealId: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [name, setName] = useState(DOC_TYPE_OPTIONS[0]);
  const [customName, setCustomName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const effectiveName = name === 'Other' ? customName.trim() : name;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveName || !file) return;
    setUploading(true);
    setError(null);
    try {
      const mimeType = file.type || 'application/octet-stream';
      const { upload_url, s3_key } = await requestUploadUrl(dealId, file.name, mimeType);
      await fetch(upload_url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': mimeType },
      });
      await confirmUpload(dealId, effectiveName, s3_key, mimeType, file.size);
      setDone(true);
      onUploaded();
    } catch {
      setError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
        <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-8 text-center">
          <CheckCircle2 size={40} className="mx-auto mb-3 text-green-400" />
          <p className="font-bold text-brand-navy mb-1">Document uploaded</p>
          <p className="text-sm text-gray-500 mb-5">
            <span className="font-semibold">{effectiveName}</span> is now saved to this deal.
          </p>
          <button onClick={onClose} className="w-full rounded-xl bg-brand-navy py-2.5 text-sm font-bold text-white hover:bg-brand-navy/90 transition-colors">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-bold text-brand-navy">Upload Document</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100 transition-colors">
            <X size={16} className="text-gray-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Document Type</label>
            <select
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-brand-navy outline-none focus:border-brand-navy/30"
            >
              {DOC_TYPE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          {name === 'Other' && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Custom Name</label>
              <input
                required
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Document name"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-brand-navy outline-none focus:border-brand-navy/30"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">File</label>
            <div className="flex items-center gap-3 rounded-xl border-2 border-dashed border-gray-200 px-4 py-5 bg-gray-50 hover:border-brand-navy/30 transition-colors">
              <FileText size={20} className="text-gray-300 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                {file ? (
                  <p className="text-sm font-medium text-brand-navy truncate">{file.name}</p>
                ) : (
                  <p className="text-sm text-gray-400">Click to select a file</p>
                )}
              </div>
              <label className="cursor-pointer rounded-lg bg-white border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition-colors">
                Browse
                <input
                  type="file"
                  className="sr-only"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
          </div>
          {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!file || !effectiveName || uploading}
              className="flex-1 rounded-xl bg-brand-navy py-2.5 text-sm font-bold text-white hover:bg-brand-navy/80 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {uploading ? <><Loader2 size={14} className="animate-spin" /> Uploading…</> : 'Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocIcon({ mimeType }: { mimeType: string }) {
  if (mimeType === 'application/pdf') return <FileText size={16} className="text-red-400 flex-shrink-0" />;
  if (mimeType.startsWith('image/')) return <FileText size={16} className="text-blue-400 flex-shrink-0" />;
  if (mimeType.includes('word') || mimeType.includes('document')) return <FileText size={16} className="text-blue-600 flex-shrink-0" />;
  return <FileText size={16} className="text-gray-400 flex-shrink-0" />;
}

function DocumentsTab({
  deal,
  docs,
  loading,
  onRefresh,
}: {
  deal: Deal;
  docs: ApiDocument[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const [showUpload, setShowUpload] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const stageReq = STAGE_GATE[deal.stage];
  const stageDocFound = stageReq ? docs.some((d) => d.name === stageReq.name) : false;

  async function handleDownload(doc: ApiDocument) {
    setDownloadingId(doc.id);
    try {
      const url = await getDownloadUrl(doc.id);
      window.open(url, '_blank');
    } catch {
      // silently fail — user sees nothing happened, can retry
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleDelete(doc: ApiDocument) {
    if (!confirm(`Delete "${doc.name}"? This cannot be undone.`)) return;
    setDeletingId(doc.id);
    try {
      await deleteDocument(doc.id);
      onRefresh();
    } catch {
      // silently fail
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-3">
      {stageReq && (
        <div className={`flex items-start gap-3 rounded-xl px-4 py-3 border ${
          stageDocFound ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
        }`}>
          {stageDocFound
            ? <CheckCircle2 size={15} className="text-green-600 flex-shrink-0 mt-0.5" />
            : <AlertTriangle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />}
          <div>
            <p className={`text-xs font-bold ${stageDocFound ? 'text-green-800' : 'text-amber-800'}`}>
              Stage requirement: {stageReq.name}
            </p>
            <p className={`text-[11px] mt-0.5 ${stageDocFound ? 'text-green-600' : 'text-amber-600'}`}>
              {stageDocFound ? 'Uploaded ✓' : stageReq.note}
            </p>
          </div>
        </div>
      )}

      <div className="rounded-xl bg-white shadow-sm overflow-hidden">
        <div className="divide-y">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-5 py-8 text-sm text-gray-400">
              <Loader2 size={15} className="animate-spin" /> Loading…
            </div>
          ) : docs.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <FileText size={28} className="mx-auto mb-2 text-gray-200" />
              <p className="text-sm text-gray-400">No documents yet</p>
              <p className="text-xs text-gray-300 mt-0.5">Upload the first one below</p>
            </div>
          ) : (
            docs.map((doc) => (
              <div key={doc.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-brand-bg transition-colors group">
                <DocIcon mimeType={doc.mimeType} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-brand-navy truncate">{doc.name}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {doc.uploaderName} · {formatFileSize(doc.fileSize)} · {new Date(doc.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleDownload(doc)}
                    disabled={downloadingId === doc.id}
                    title="Download"
                    className="rounded-lg p-1.5 hover:bg-gray-100 transition-colors text-gray-400 hover:text-brand-navy disabled:opacity-40"
                  >
                    {downloadingId === doc.id
                      ? <Loader2 size={14} className="animate-spin" />
                      : <ExternalLink size={14} />}
                  </button>
                  <button
                    onClick={() => handleDelete(doc)}
                    disabled={deletingId === doc.id}
                    title="Delete"
                    className="rounded-lg p-1.5 hover:bg-red-50 transition-colors text-gray-400 hover:text-red-500 disabled:opacity-40"
                  >
                    {deletingId === doc.id
                      ? <Loader2 size={14} className="animate-spin" />
                      : <X size={14} />}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="border-t px-5 py-3 flex items-center justify-between">
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-brand-navy hover:text-brand-navy/70 transition-colors"
          >
            <Plus size={14} /> Upload Document
          </button>
          <button
            onClick={onRefresh}
            className="rounded-lg p-1.5 hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {showUpload && (
        <UploadDocModal
          dealId={deal.id ?? ''}
          onClose={() => setShowUpload(false)}
          onUploaded={() => { setShowUpload(false); onRefresh(); }}
        />
      )}
    </div>
  );
}

// ─── Vendors Tab ─────────────────────────────────────────────────────────────

// ── Add/Edit Contact Modal ────────────────────────────────────────────────────

type ContactRole = 'lender' | 'titleCompany' | 'closingAttorney' | 'inspector' | 'insurance' | 'other';

const CONTACT_ROLE_LABELS: Record<ContactRole, string> = {
  lender: 'Lender',
  titleCompany: 'Title Company',
  closingAttorney: 'Closing Attorney',
  inspector: 'Home Inspector',
  insurance: 'Homeowners Insurance',
  other: 'Other',
};

type ContactForm = {
  role: ContactRole;
  company: string;
  contactName: string;
  phone: string;
  email: string;
  portalUrl: string;
};

const EMPTY_FORM: ContactForm = {
  role: 'lender',
  company: '',
  contactName: '',
  phone: '',
  email: '',
  portalUrl: '',
};

function AddContactModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: Partial<ContactForm>;
  onSave: (data: ContactForm) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ContactForm>({ ...EMPTY_FORM, ...initial });

  function field(label: string, key: keyof ContactForm, type = 'text', placeholder = '') {
    return (
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
        <input
          type={type}
          value={form[key] as string}
          onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
          placeholder={placeholder}
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-brand-navy outline-none focus:border-brand-navy/30 focus:ring-2 focus:ring-brand-navy/10"
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-bold text-brand-navy">Add Transaction Contact</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100 transition-colors">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        {/* Form */}
        <div className="p-5 space-y-3">
          {/* Role picker */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Role</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(CONTACT_ROLE_LABELS) as ContactRole[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setForm((p) => ({ ...p, role: r }))}
                  className={`rounded-lg border py-2 text-xs font-semibold transition-colors ${
                    form.role === r
                      ? 'border-brand-navy bg-brand-navy text-white'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {CONTACT_ROLE_LABELS[r]}
                </button>
              ))}
            </div>
          </div>

          {field('Company / Organization', 'company', 'text', 'e.g. Alabama Title Group')}
          {field('Contact Name', 'contactName', 'text', 'e.g. Diane Foster')}
          {field('Phone', 'phone', 'tel', '(205) 555-0000')}
          {field('Email', 'email', 'email', 'name@company.com')}
          {field('Portal URL (optional)', 'portalUrl', 'url', 'https://')}
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={!form.company.trim()}
            className="flex-1 rounded-xl bg-brand-navy py-2.5 text-sm font-bold text-white hover:bg-brand-navy/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save Contact
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Transaction contact row ───────────────────────────────────────────────────

function ContactRow({
  role,
  name,
  subtitle,
  phone,
  email,
  portalUrl,
  badge,
  avatarLetter,
  avatarColor,
  onEdit,
}: {
  role: string;
  name: string;
  subtitle?: string;
  phone?: string;
  email?: string;
  portalUrl?: string;
  badge?: React.ReactNode;
  avatarLetter: string;
  avatarColor: string;
  onEdit?: () => void;
}) {
  return (
    <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-50 last:border-0">
      <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-white text-sm font-bold ${avatarColor}`}>
        {avatarLetter}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-brand-navy">{name}</span>
          {badge}
        </div>
        <p className="text-xs text-gray-400 mt-0.5">{role}{subtitle ? ` · ${subtitle}` : ''}</p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {phone && (
            <a href={`tel:${phone}`}
              className="flex items-center gap-1 rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors">
              <Phone size={10} /> {phone}
            </a>
          )}
          {email && (
            <a href={`mailto:${email}`}
              className="flex items-center gap-1 rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors">
              <Mail size={10} /> Email
            </a>
          )}
          {portalUrl && (
            <a href={portalUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-lg bg-brand-navy/5 border border-brand-navy/10 px-2.5 py-1 text-xs font-semibold text-brand-navy hover:bg-brand-navy/10 transition-colors">
              <ExternalLink size={10} /> Portal
            </a>
          )}
        </div>
      </div>
      {onEdit && (
        <button onClick={onEdit}
          className="flex-shrink-0 rounded-lg p-1.5 hover:bg-gray-100 transition-colors mt-0.5">
          <Pencil size={13} className="text-gray-400" />
        </button>
      )}
    </div>
  );
}

// ── Preferred vendor category accordion ──────────────────────────────────────

function PreferredCategoryRow({ category, vendors }: { category: VendorCategory; vendors: ReturnType<typeof useVendors>['vendors'] }) {
  const [open, setOpen] = useState(false);
  if (vendors.length === 0) return null;

  return (
    <div className="border-b border-gray-50 last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-brand-navy">
            {VENDOR_CATEGORY_LABELS[category]}
          </span>
          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">
            {vendors.length}
          </span>
        </div>
        {open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
      </button>

      {open && (
        <div className="px-5 pb-4 space-y-2">
          {vendors.map((v) => (
            <div key={v.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3.5">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    {v.isFeatured && <Star size={11} className="text-brand-gold fill-brand-gold flex-shrink-0" />}
                    <span className="text-sm font-semibold text-brand-navy">{v.company}</span>
                  </div>
                  {v.contactName && <p className="text-xs text-gray-400 mt-0.5">{v.contactName}</p>}
                  {v.notes && <p className="text-xs text-gray-500 mt-1 italic leading-relaxed">"{v.notes}"</p>}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {v.phone && (
                  <a href={`tel:${v.phone}`}
                    className="flex items-center gap-1 rounded-lg bg-white border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors">
                    <Phone size={10} /> {v.phone}
                  </a>
                )}
                {v.email && (
                  <a href={`mailto:${v.email}`}
                    className="flex items-center gap-1 rounded-lg bg-white border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors">
                    <Mail size={10} /> Email
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main VendorsTab ───────────────────────────────────────────────────────────

function VendorsTab({ deal }: { deal: Deal }) {
  const [showModal, setShowModal] = useState(false);
  const [localVendors, setLocalVendors] = useState(deal.vendors ?? {});

  // Look up agent and TC from user list
  const agent = MOCK_USERS.find((u) => u.id === deal.agentId);
  const tc = MOCK_USERS.find((u) => u.groupId === 'tc' && u.dealIds.includes(deal.id));

  function handleSave(form: ContactForm) {
    if (form.role === 'other') {
      setShowModal(false);
      return;
    }
    const newContact = {
      company: form.company,
      contactName: form.contactName || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
    };
    if (form.role === 'lender') {
      setLocalVendors((p) => ({
        ...p,
        lender: { ...newContact, isAriveIntegrated: false },
      }));
    } else {
      setLocalVendors((p) => ({ ...p, [form.role]: newContact }));
    }
    setShowModal(false);
  }

  const { vendors: preferredVendors } = useVendors();
  const availableCategories = VENDOR_CATEGORY_ORDER.filter((cat) =>
    preferredVendors.some((v) => v.category === cat)
  );

  return (
    <>
      {showModal && (
        <AddContactModal onSave={handleSave} onClose={() => setShowModal(false)} />
      )}

      <div className="space-y-4">

        {/* ── Section 1: Transaction Team ───────────────────────────────────── */}
        <div className="rounded-xl bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Users size={14} className="text-brand-navy" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500">
                Transaction Team
              </h3>
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1 rounded-lg bg-brand-navy px-2.5 py-1.5 text-xs font-bold text-white hover:bg-brand-navy/80 transition-colors"
            >
              <Plus size={11} /> Add Contact
            </button>
          </div>

          {/* Agent */}
          {agent && (
            <ContactRow
              role="Agent"
              name={agent.name}
              subtitle={agent.email}
              phone="(205) 555-0100"
              email={agent.email}
              avatarLetter={agent.name.charAt(0)}
              avatarColor="bg-brand-navy"
            />
          )}

          {/* TC */}
          {tc && (
            <ContactRow
              role="Transaction Coordinator"
              name={tc.name}
              email={tc.email}
              avatarLetter={tc.name.charAt(0)}
              avatarColor="bg-amber-500"
            />
          )}

          {/* Lender */}
          {localVendors.lender ? (
            <ContactRow
              role="Lender"
              name={localVendors.lender.company}
              subtitle={localVendors.lender.loanOfficer ?? localVendors.lender.contactName}
              phone={localVendors.lender.phone}
              email={localVendors.lender.email}
              portalUrl={(localVendors.lender as any).portalUrl}
              badge={
                localVendors.lender.isAriveIntegrated ? (
                  <span className="flex items-center gap-0.5 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
                    <RefreshCw size={8} /> ARIVE
                  </span>
                ) : null
              }
              avatarLetter={localVendors.lender.company.charAt(0)}
              avatarColor="bg-blue-500"
              onEdit={() => setShowModal(true)}
            />
          ) : (
            <div className="px-5 py-3 border-b border-gray-50">
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-brand-navy transition-colors"
              >
                <Plus size={12} />
                {deal.type === 'buy' ? 'Add lender contact' : "Add buyer's lender"}
              </button>
            </div>
          )}

          {/* Title Company */}
          {localVendors.titleCompany ? (
            <ContactRow
              role="Title Company"
              name={localVendors.titleCompany.company}
              subtitle={localVendors.titleCompany.contactName}
              phone={localVendors.titleCompany.phone}
              email={localVendors.titleCompany.email}
              avatarLetter={localVendors.titleCompany.company.charAt(0)}
              avatarColor="bg-purple-500"
              onEdit={() => setShowModal(true)}
            />
          ) : (
            <div className="px-5 py-3 border-b border-gray-50">
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-brand-navy transition-colors"
              >
                <Plus size={12} /> Add title company
              </button>
            </div>
          )}

          {/* Closing Attorney */}
          {localVendors.closingAttorney ? (
            <ContactRow
              role="Closing Attorney"
              name={localVendors.closingAttorney.company}
              subtitle={localVendors.closingAttorney.contactName}
              phone={localVendors.closingAttorney.phone}
              email={localVendors.closingAttorney.email}
              avatarLetter={localVendors.closingAttorney.company.charAt(0)}
              avatarColor="bg-indigo-500"
              onEdit={() => setShowModal(true)}
            />
          ) : (
            <div className="px-5 py-3 border-b border-gray-50">
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-brand-navy transition-colors"
              >
                <Plus size={12} /> Add closing attorney
              </button>
            </div>
          )}

          {/* Inspector */}
          {localVendors.inspector ? (
            <ContactRow
              role="Home Inspector"
              name={localVendors.inspector.company}
              subtitle={localVendors.inspector.contactName}
              phone={localVendors.inspector.phone}
              email={localVendors.inspector.email}
              avatarLetter={localVendors.inspector.company.charAt(0)}
              avatarColor="bg-orange-400"
              onEdit={() => setShowModal(true)}
            />
          ) : (
            <div className="px-5 py-3 border-b border-gray-50">
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-brand-navy transition-colors"
              >
                <Plus size={12} /> Add inspector
              </button>
            </div>
          )}

          {/* Homeowners Insurance */}
          {localVendors.insurance ? (
            <ContactRow
              role="Homeowners Insurance"
              name={localVendors.insurance.company}
              subtitle={localVendors.insurance.contactName}
              phone={localVendors.insurance.phone}
              email={localVendors.insurance.email}
              avatarLetter={localVendors.insurance.company.charAt(0)}
              avatarColor="bg-teal-500"
              onEdit={() => setShowModal(true)}
            />
          ) : (
            <div className="px-5 py-3">
              <button
                onClick={() => setShowModal(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-brand-navy transition-colors"
              >
                <Plus size={12} /> Add insurance contact
              </button>
            </div>
          )}
        </div>

        {/* ── Section 2: Preferred Vendor Directory ─────────────────────────── */}
        {availableCategories.length > 0 && (
          <div className="rounded-xl bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100">
              <Star size={14} className="text-brand-gold" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500">
                Preferred Vendors
              </h3>
              <span className="ml-auto text-xs text-gray-400">
                {availableCategories.length} categories
              </span>
            </div>
            <p className="px-5 py-2.5 text-xs text-gray-400 bg-gray-50 border-b border-gray-100">
              Sarah's trusted vendor directory — shared with clients on their portal.
            </p>
            {availableCategories.map((cat) => (
              <PreferredCategoryRow key={cat} category={cat} vendors={preferredVendors.filter((v) => v.category === cat)} />
            ))}
          </div>
        )}

      </div>
    </>
  );
}

// ─── Timeline Tab ────────────────────────────────────────────────────────────

const DEAL_STAGE_DAYS: Record<string, Partial<Record<DealStage, number>>> = {
  'deal-smith':    { intake: 3,  active_search: 21, offer_active: 4 },
  'deal-garcia':   { intake: 2 },
  'deal-williams': { intake: 5,  active_search: 18, offer_active: 7, under_contract: 22, pre_close: 8 },
  'deal-johnson':  { intake: 9 },
  'deal-chen':     { intake: 4,  active_search: 19, offer_active: 6, under_contract: 14, pre_close: 11 },
};

function TimelineTab({ deal, tasks }: { deal: Deal; tasks: Task[] }) {
  const currentStageIndex = STAGE_ORDER.indexOf(deal.stage);

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
                  {isPast && DEAL_STAGE_DAYS[deal.id]?.[stage] !== undefined && (
                    <span className="text-[11px] font-medium text-gray-400">
                      {DEAL_STAGE_DAYS[deal.id][stage]}d
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

function StageAdvanceModal({ deal, nextStage, onConfirm, onCancel }: {
  deal: Deal;
  nextStage: DealStage;
  onConfirm: (draftMessage: string) => void;
  onCancel: () => void;
}) {
  const autoTasks = STAGE_AUTO_TASKS[nextStage]?.(deal) ?? [];
  const defaultMsg = STAGE_DRAFT_MESSAGE[nextStage]?.(deal) ?? '';
  const [msg, setMsg] = useState(defaultMsg);
  const [editingMsg, setEditingMsg] = useState(false);

  const automationItems = [
    autoTasks.length > 0 ? `${autoTasks.length} task${autoTasks.length !== 1 ? 's' : ''} auto-generated` : null,
    defaultMsg ? `Client message drafted for ${deal.clientName}` : null,
    nextStage === 'under_contract' ? 'TC alerted to open file' : null,
    nextStage === 'pre_close' || nextStage === 'closing' ? 'Closing date synced to calendar' : null,
    nextStage === 'post_close' ? 'Commission paperwork queued' : null,
  ].filter(Boolean) as string[];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-0">
      <div className="w-full max-w-lg rounded-t-2xl bg-white shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Stage Advance</p>
          <h3 className="text-base font-black text-brand-navy mt-0.5">
            Moving to: <span className="text-brand-navy">{STAGE_LABELS[nextStage]}</span>
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">{deal.clientName} · {deal.property.address}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Automation summary */}
          {automationItems.length > 0 && (
            <div className="rounded-xl bg-brand-navy/5 border border-brand-navy/10 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Zap size={14} className="text-brand-navy" />
                <p className="text-xs font-bold uppercase tracking-widest text-brand-navy">Will run automatically</p>
              </div>
              <div className="space-y-2">
                {automationItems.map((item) => (
                  <div key={item} className="flex items-center gap-2">
                    <CheckCircle2 size={13} className="text-green-500 flex-shrink-0" />
                    <span className="text-sm text-gray-700">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Auto-generated tasks preview */}
          {autoTasks.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Tasks to be created</p>
              <div className="space-y-1.5">
                {autoTasks.map((task, i) => (
                  <div key={i} className="flex items-start gap-2.5 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5">
                    <Circle size={12} className="text-gray-300 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-brand-navy leading-snug">{task.title}</p>
                      {task.description && (
                        <p className="text-[10px] text-gray-400 mt-0.5">{task.description}</p>
                      )}
                    </div>
                    <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      task.assignedTo === 'tc' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {task.assignedTo === 'tc' ? 'TC' : 'Agent'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Client message draft */}
          {defaultMsg && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Client message</p>
                <button
                  onClick={() => setEditingMsg((p) => !p)}
                  className="flex items-center gap-1 text-xs font-semibold text-brand-navy hover:text-brand-navy/70 transition-colors"
                >
                  <Pencil size={11} /> {editingMsg ? 'Done' : 'Edit'}
                </button>
              </div>
              {editingMsg ? (
                <textarea
                  value={msg}
                  onChange={(e) => setMsg(e.target.value)}
                  rows={5}
                  className="w-full rounded-xl border border-brand-navy/20 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none focus:border-brand-navy/40 resize-none leading-relaxed"
                />
              ) : (
                <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
                  <p className="text-sm text-gray-700 leading-relaxed">{msg}</p>
                </div>
              )}
              <p className="mt-1.5 text-[10px] text-gray-400">Sent to client's portal — they'll see it immediately.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-5 py-4 space-y-2">
          <button
            onClick={() => onConfirm(msg)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-navy py-3.5 text-sm font-bold text-white hover:bg-brand-navy/90 transition-colors"
          >
            <Zap size={14} /> Confirm & Advance
          </button>
          <button
            onClick={onCancel}
            className="w-full text-center text-sm text-gray-400 hover:text-gray-600 py-1.5 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Stage Transition Bar ────────────────────────────────────────────────────

function StageTransitionBar({
  stage,
  deal,
  onAdvance,
  onRetreat,
}: {
  stage: DealStage;
  deal: Deal;
  onAdvance: () => void;
  onRetreat: () => void;
}) {
  const idx = STAGE_ORDER.indexOf(stage);
  const prevStage = idx > 0 ? STAGE_ORDER[idx - 1] : null;
  const nextStage = idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : null;

  const nextGate = nextStage ? STAGE_GATE[nextStage] : null;
  const gateDocSigned = true;

  const isOfferActive = stage === 'offer_active';
  const { properties: stageProperties } = useProperties(isOfferActive ? deal.id : undefined);
  const offerProperty = isOfferActive
    ? stageProperties.find((p) => p.offerRequested)
    : null;

  return (
    <div className="rounded-xl bg-white shadow-sm border border-gray-100 overflow-hidden">
      {/* Progress pip track */}
      <div className="flex gap-0.5 px-4 pt-3">
        {STAGE_ORDER.map((s, i) => (
          <div
            key={s}
            className={[
              'h-1 flex-1 rounded-full transition-all',
              i < idx ? 'bg-brand-navy/40' :
              i === idx ? isOfferActive ? 'bg-amber-400' : 'bg-brand-navy' :
              'bg-gray-100',
            ].join(' ')}
          />
        ))}
      </div>

      {/* Stage label + step counter */}
      <div className="text-center px-4 pt-2 pb-1">
        <p className="text-base font-black text-brand-navy tracking-tight">{STAGE_LABELS[stage]}</p>
        <p className="text-[10px] text-gray-400 font-medium">Stage {idx + 1} of {STAGE_ORDER.length}</p>
      </div>

      {/* Offer context banner */}
      {isOfferActive && (
        <div className="mx-4 mb-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
          <p className="text-xs font-bold text-amber-800 mb-0.5">
            {offerProperty ? `Offer on ${offerProperty.address}` : 'Offer pending — awaiting seller response'}
          </p>
          <p className="text-[11px] text-amber-600 leading-snug">
            Mark accepted to move into contract, or rejected to return to home search.
          </p>
        </div>
      )}

      {/* Warning */}
      {!isOfferActive && nextGate && !gateDocSigned && (
        <div className="mx-4 mb-2 flex items-center gap-1.5 rounded-lg bg-amber-50 border border-amber-100 px-3 py-1.5">
          <AlertTriangle size={12} className="text-amber-500 flex-shrink-0" />
          <p className="text-[11px] text-amber-700 font-medium">
            Heads up: {nextGate.name} not yet signed
          </p>
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-2 px-4 pb-4">
        <button
          onClick={onRetreat}
          disabled={!prevStage}
          className={[
            'flex flex-1 items-center justify-center gap-1.5 rounded-xl border-2 px-4 py-2.5 text-sm font-bold disabled:opacity-25 disabled:cursor-not-allowed transition-colors',
            isOfferActive
              ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
              : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50',
          ].join(' ')}
        >
          <ChevronLeft size={15} />
          {isOfferActive ? 'Offer Rejected' : prevStage ? STAGE_LABELS[prevStage] : 'Back'}
        </button>
        <button
          onClick={onAdvance}
          disabled={!nextStage}
          className={[
            'flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-25 disabled:cursor-not-allowed transition-colors shadow-sm',
            isOfferActive
              ? 'bg-green-500 hover:bg-green-600'
              : 'bg-brand-navy hover:bg-brand-navy/85',
          ].join(' ')}
        >
          {isOfferActive ? 'Offer Accepted' : nextStage ? STAGE_LABELS[nextStage] : 'Complete'}
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

// ─── Deal Header ─────────────────────────────────────────────────────────────

function DealHeader({ deal, onFlagChange }: { deal: Deal; onFlagChange?: (flags: { preApproved?: boolean }) => void }) {
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
          {(() => {
            const days = Math.max(0, Math.round((new Date(deal.timeline.closingDate).getTime() - Date.now()) / 86_400_000));
            return <span className="font-bold text-brand-navy">({days}d)</span>;
          })()}
          <span className="mx-1">·</span>
          <Clock size={11} />
          <span>{deal.timeline.daysInStage} days in current stage</span>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function DealDetail() {
  const { dealId } = useParams<{ dealId: string }>();
  const navigate = useNavigate();
  const activeUser = useAuthStore((s) => s.activeUser);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);

  const { deal: apiDeal, loading: dealLoading, refresh: refreshDeal } = useDeal(dealId);
  const { tasks: dealTasks, refresh: refreshTasks } = useTasks(dealId ?? '');
  const { stageByDeal, setStage } = useDealStageStore();
  const addClientNotification = useNotificationStore((s) => s.addClientNotification);

  if (dealLoading) {
    return (
      <div className="max-w-3xl">
        <button
          onClick={() => navigate(-1)}
          className="mb-4 flex items-center gap-1.5 text-sm text-gray-400 hover:text-brand-navy transition-colors"
        >
          <ArrowLeft size={14} /> Back
        </button>
        <div className="rounded-xl bg-white p-10 text-center shadow-sm">
          <p className="text-gray-400">Loading deal…</p>
        </div>
      </div>
    );
  }

  if (!apiDeal) {
    return (
      <div className="max-w-3xl">
        <button
          onClick={() => navigate(-1)}
          className="mb-4 flex items-center gap-1.5 text-sm text-gray-400 hover:text-brand-navy transition-colors"
        >
          <ArrowLeft size={14} /> Back
        </button>
        <div className="rounded-xl bg-white p-10 text-center shadow-sm">
          <p className="text-gray-400">Deal not found.</p>
        </div>
      </div>
    );
  }

  const deal = apiDeal;
  const stage = stageByDeal[deal.id] ?? deal.stage;
  const localDeal = { ...deal, stage };
  const canAdvanceStage = ['agent', 'tc', 'admin'].includes(activeUser?.groupId ?? '');

  const CLIENT_STAGE_MESSAGES: Partial<Record<DealStage, { title: string; body: string }>> = {
    active_search: {
      title: "You're cleared to start your home search!",
      body: "Your agent has set up your search portal. Start tracking homes and get your pre-approval in place.",
    },
    offer_active: {
      title: "Your offer has been submitted!",
      body: "We're waiting to hear back from the seller. Stay available — your agent may need a quick response.",
    },
    under_contract: {
      title: deal.type === 'sell' ? "You have an accepted offer!" : "Your offer was accepted — you're under contract!",
      body: deal.type === 'sell'
        ? "The buyer's contingency period has started. Check your portal for next steps."
        : "Key deadlines are starting now. Check your portal — there are tasks that need your attention.",
    },
    pre_close: {
      title: "All contingencies cleared — almost there!",
      body: deal.type === 'sell'
        ? "Closing is confirmed. Start coordinating your move-out and check your portal for final tasks."
        : "Final stretch. Review your closing disclosure and confirm your wire instructions with your agent.",
    },
    closing: {
      title: "Today is closing day!",
      body: deal.type === 'sell'
        ? "Check your portal for what to bring and where to go. You're almost done!"
        : "Check your portal for what to bring to the closing table. Congratulations — you're almost a homeowner!",
    },
    post_close: {
      title: deal.type === 'sell' ? "Your home has officially sold!" : "Welcome home! 🏡",
      body: deal.type === 'sell'
        ? "Congratulations! Check your portal for your net proceeds summary and next steps."
        : "Congratulations! Check your portal for move-in next steps and your Fast Pass status.",
    },
  };

  function advanceStage() {
    setShowAdvanceModal(true);
  }

  async function handleAdvanceConfirm(_draftMessage: string) {
    const idx = STAGE_ORDER.indexOf(stage);
    if (idx < STAGE_ORDER.length - 1) {
      const nextStage = STAGE_ORDER[idx + 1];
      try {
        await patchStage(deal.id, nextStage);
      } catch {
        setShowAdvanceModal(false);
        return;
      }
      setStage(deal.id, nextStage);
      refreshDeal();
      const msg = CLIENT_STAGE_MESSAGES[nextStage];
      if (msg) {
        addClientNotification({ dealId: deal.id, title: msg.title, body: msg.body });
      }
      const autoTasks = STAGE_AUTO_TASKS[nextStage]?.(deal) ?? [];
      await Promise.allSettled(
        autoTasks.map((taskDef) =>
          postTask(deal.id, {
            title: taskDef.title,
            description: taskDef.description,
            priority: taskDef.priority,
            source: 'ai',
            stage_context: nextStage,
            role: taskDef.assignedTo,
          }),
        ),
      );
      refreshTasks();
    }
    setShowAdvanceModal(false);
  }

  async function retreatStage() {
    const idx = STAGE_ORDER.indexOf(stage);
    if (idx > 0) {
      const prevStage = STAGE_ORDER[idx - 1];
      try {
        await patchStage(deal.id, prevStage);
      } catch {
        return;
      }
      setStage(deal.id, prevStage);
      refreshDeal();
    }
  }

  const { docs: dealDocs, loading: docsLoading, refresh: refreshDocs } = useDocuments(deal.id ?? '');
  const tabCounts: Partial<Record<TabId, number>> = {
    tasks: dealTasks.filter((t) => t.status !== 'completed').length,
    documents: dealDocs.length,
  };

  return (
    <div className="max-w-3xl space-y-4">
      {/* Back nav */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-brand-navy transition-colors w-fit"
      >
        <ArrowLeft size={14} /> Back
      </button>

      {/* Deal header */}
      <DealHeader deal={localDeal} onFlagChange={async (flags) => {
        await api.patch(`/deals/${localDeal.id}/flags`, flags).catch(() => {});
        refreshDeal();
      }} />

      {/* Stage transition bar — agents, TCs, admins only */}
      {canAdvanceStage && deal.status !== 'fallen_through' && (
        <StageTransitionBar
          stage={stage}
          deal={deal}
          onAdvance={advanceStage}
          onRetreat={retreatStage}
        />
      )}

      {/* Stage advance automation modal */}
      {showAdvanceModal && (() => {
        const idx = STAGE_ORDER.indexOf(stage);
        const nextStage = idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : null;
        return nextStage ? (
          <StageAdvanceModal
            deal={deal}
            nextStage={nextStage}
            onConfirm={handleAdvanceConfirm}
            onCancel={() => setShowAdvanceModal(false)}
          />
        ) : null;
      })()}

      {/* Tabs */}
      <div className="flex gap-0.5 rounded-xl bg-white p-1 shadow-sm overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const count = tabCounts[tab.id];
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={[
                'flex items-center gap-1.5 flex-shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'bg-brand-navy text-white shadow-sm'
                  : 'text-gray-500 hover:bg-brand-bg',
              ].join(' ')}
            >
              <Icon size={14} />
              {tab.label}
              {count !== undefined && count > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                  activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-brand-navy/10 text-brand-navy'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && <OverviewTab deal={localDeal} tasks={dealTasks} onRefresh={refreshDeal} />}
      {activeTab === 'tasks' && <TasksTab deal={localDeal} tasks={dealTasks} onTasksChange={refreshTasks} />}
      {activeTab === 'messages' && <MessagesTab deal={localDeal} />}
      {activeTab === 'documents' && <DocumentsTab deal={localDeal} docs={dealDocs} loading={docsLoading} onRefresh={refreshDocs} />}
      {activeTab === 'timeline' && <TimelineTab deal={localDeal} tasks={dealTasks} />}
      {activeTab === 'vendors' && <VendorsTab deal={localDeal} />}
    </div>
  );
}
