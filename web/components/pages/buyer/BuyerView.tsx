"use client";

import { useState } from 'react';
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/authStore";
import { Deal, DealStage } from "@/lib/data/mockDeals";
import { Task } from "@/lib/data/mockTasks";
import { useMyDeals } from "@/hooks/useMyDeals";
import { useTasks } from "@/hooks/useTasks";
import { useMessages, postMessage } from "@/hooks/useMessages";
import {
  CheckCircle2, Circle, AlertCircle, Loader2, XCircle,
  MapPin, Calendar, MessageSquare, FileText,
  ChevronRight, Phone, Mail, Home, Zap,
  ClipboardList, Building2, Star, ExternalLink,
  Plus, X, Link as LinkIcon, MessageCircle, Pencil, Send, Upload,
} from 'lucide-react';
import MetroMap from "@/components/MetroMap";
import VendorDirectory from "@/components/VendorDirectory";
import { useProperties, TrackedProperty, PropertyStatus } from "@/hooks/useProperties";
import { useMLSListings, MLSListing } from "@/hooks/useMLS";
import { useAgentDocStore } from "@/lib/store/agentDocStore";
import { useAgentDocTemplatesForDeal, DOC_TYPE_LABELS } from "@/hooks/useAgentDocs";
import { useDocuments, getDownloadUrl as getDealDocDownloadUrl } from "@/hooks/useDocuments";
import ClientNotifications from "@/components/ClientNotifications";
import { api } from "@/lib/api-client";
import { FAST_PASS_UPSELLS, FastPassUpsellId } from "@/lib/data/mockFastPass";

// ─── Constants ────────────────────────────────────────────────────────────────

const BUYER_STAGE_LABELS: Record<DealStage, string> = {
  intake:         'Getting Started',
  active_search:  'Home Search',
  offer_active:   'Offer Submitted',
  under_contract: 'Under Contract',
  pre_close:      'Pre-Close',
  closing:        'Closing Day',
  post_close:     'Closed!',
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
  const [expanded, setExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);

  const isOverdue = task.status === 'overdue';
  const isDone = task.status === 'completed';
  const actionType = task.actionType ?? 'confirm';

  function handleConfirm() {
    onComplete?.(task.id);
    setExpanded(false);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length) return;
    setUploading(true);
    setTimeout(() => { setUploading(false); setUploaded(true); }, 1500);
  }

  return (
    <div className={`rounded-xl overflow-hidden transition-all ${
      isOverdue ? 'bg-red-50 border border-red-100' :
      isDone    ? 'bg-gray-50 border border-gray-100 opacity-60' :
      'bg-white border border-gray-100'
    }`}>
      {/* Header row */}
      <button
        onClick={() => !isDone && setExpanded((p) => !p)}
        disabled={isDone}
        className="w-full text-left flex items-start gap-3 p-4 hover:bg-black/[0.02] transition-colors active:scale-[0.99]"
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
              {isOverdue ? 'Overdue — ' : 'Due '}
              {task.dueDate}
            </p>
          )}
          {isDone && <p className="mt-0.5 text-[11px] text-green-600">Marked complete</p>}
        </div>
        {!isDone && (
          <ChevronRight size={14} className={`flex-shrink-0 text-gray-300 mt-0.5 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} />
        )}
      </button>

      {/* Action panel */}
      {expanded && !isDone && (
        <div className={`border-t px-4 py-3 space-y-2 ${isOverdue ? 'border-red-100 bg-red-50/40' : 'border-gray-100 bg-gray-50/60'}`}>

          {actionType === 'confirm' && (
            <>
              <p className="text-xs text-gray-500 leading-relaxed">Did you complete this outside the app?</p>
              <div className="flex gap-2">
                <button
                  onClick={handleConfirm}
                  className="flex-1 rounded-lg bg-green-500 py-2.5 text-xs font-bold text-white hover:bg-green-600 transition-colors"
                >
                  Yes, I&apos;m done ✓
                </button>
                <button
                  onClick={() => setExpanded(false)}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-xs font-semibold text-gray-500 hover:bg-gray-50 transition-colors"
                >
                  Not yet
                </button>
              </div>
            </>
          )}

          {actionType === 'upload' && (
            <>
              {!uploaded ? (
                <>
                  <p className="text-xs text-gray-500 leading-relaxed">Upload the document to complete this task.</p>
                  <label className={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed py-3 text-xs font-semibold transition-colors ${
                    uploading
                      ? 'border-blue-200 bg-blue-50 text-blue-400 pointer-events-none'
                      : 'border-gray-200 text-gray-400 hover:border-brand-navy/30 hover:text-brand-navy'
                  }`}>
                    {uploading
                      ? <><Loader2 size={13} className="animate-spin" /> Uploading…</>
                      : <><Upload size={13} /> Choose file to upload</>}
                    <input type="file" className="hidden" onChange={handleFileChange} disabled={uploading} />
                  </label>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-100 px-3 py-2">
                    <CheckCircle2 size={13} className="text-green-500 flex-shrink-0" />
                    <p className="text-xs text-green-700 font-medium">File uploaded successfully</p>
                  </div>
                  <button
                    onClick={handleConfirm}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-green-500 py-2.5 text-xs font-bold text-white hover:bg-green-600 transition-colors"
                  >
                    Mark as complete ✓
                  </button>
                </>
              )}
              {!uploaded && (
                <button onClick={() => setExpanded(false)} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 transition-colors pt-0.5">
                  Close
                </button>
              )}
            </>
          )}

          {actionType === 'link' && (
            <>
              <p className="text-xs text-gray-500 leading-relaxed">Open the link to complete this task, then mark it done here.</p>
              {task.actionUrl && (
                <a
                  href={task.actionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-navy py-2.5 text-xs font-bold text-white hover:bg-brand-navy/90 transition-colors"
                >
                  <ExternalLink size={12} /> Open Application →
                </a>
              )}
              <button
                onClick={handleConfirm}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-green-200 bg-green-50 py-2 text-xs font-bold text-green-700 hover:bg-green-100 transition-colors"
              >
                <CheckCircle2 size={12} /> I&apos;ve completed this
              </button>
              <button onClick={() => setExpanded(false)} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 transition-colors pt-0.5">
                Close
              </button>
            </>
          )}

        </div>
      )}
    </div>
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
              isAgent ? 'bg-brand-navy' : 'bg-green-500'
            }`}>
              {msg.senderName.charAt(0)}
            </div>
            <div className={`max-w-[78%] flex flex-col gap-1 ${isAgent ? 'items-start' : 'items-end'}`}>
              <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                isAgent ? 'bg-gray-100 text-gray-800 rounded-tl-sm' : 'bg-brand-navy text-white rounded-tr-sm'
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

function DocumentsTab({ dealId }: { dealId: string }) {
  const { templates, loading: tLoading, getDownloadUrl: getTemplateUrl } = useAgentDocTemplatesForDeal(dealId);
  const { docs, loading: dLoading } = useDocuments(dealId);
  const [downloading, setDownloading] = useState<string | null>(null);

  async function handleDownload(id: string, isTemplate: boolean) {
    setDownloading(id);
    try {
      const url = isTemplate ? await getTemplateUrl(id) : await getDealDocDownloadUrl(id);
      window.open(url, '_blank');
    } catch {
      // ignore
    } finally {
      setDownloading(null);
    }
  }

  if (tLoading || dLoading) {
    return <div className="py-6 text-center text-sm text-gray-400">Loading documents…</div>;
  }

  if (templates.length === 0 && docs.length === 0) {
    return (
      <div className="rounded-xl bg-white px-4 py-8 text-center text-sm text-gray-400">
        No documents yet — your agent will share forms here.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {templates.length > 0 && (
        <section>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">Agent Forms</p>
          <div className="space-y-2">
            {templates.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-xl bg-white border border-gray-100 px-4 py-3">
                <FileText size={16} className="flex-shrink-0 text-gray-300" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-brand-navy truncate">{t.name}</p>
                  <p className="text-[11px] text-gray-400">{DOC_TYPE_LABELS[t.docType] ?? t.docType}</p>
                </div>
                <button
                  onClick={() => handleDownload(t.id, true)}
                  disabled={downloading === t.id}
                  className="flex items-center gap-1 rounded-lg bg-brand-navy/5 px-2.5 py-1 text-xs font-semibold text-brand-navy hover:bg-brand-navy/10 disabled:opacity-50 transition-colors"
                >
                  {downloading === t.id ? <Loader2 size={11} className="animate-spin" /> : <ExternalLink size={11} />}
                  Open
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {docs.length > 0 && (
        <section>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">Deal Documents</p>
          <div className="space-y-2">
            {docs.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-xl bg-white border border-gray-100 px-4 py-3">
                <FileText size={16} className="flex-shrink-0 text-gray-300" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-brand-navy truncate">{d.name}</p>
                  <p className="text-[11px] text-gray-400">
                    {new Date(d.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                <button
                  onClick={() => handleDownload(d.id, false)}
                  disabled={downloading === d.id}
                  className="flex items-center gap-1 rounded-lg bg-brand-navy/5 px-2.5 py-1 text-xs font-semibold text-brand-navy hover:bg-brand-navy/10 disabled:opacity-50 transition-colors"
                >
                  {downloading === d.id ? <Loader2 size={11} className="animate-spin" /> : <ExternalLink size={11} />}
                  Open
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Shared: Agent card ───────────────────────────────────────────────────────

function AgentCard({ compact = false, agentName, agentEmail, agentPhone }: {
  compact?: boolean;
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
      {!compact && (
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
      )}
    </div>
  );
}

// ─── Journey tracker ──────────────────────────────────────────────────────────

const STAGE_DESCRIPTIONS: Record<DealStage, string> = {
  intake:         'Getting your file set up with your agent.',
  active_search:  'Finding homes that match your wish list.',
  offer_active:   'Offer submitted — waiting on the seller.',
  under_contract: 'Under contract and working through the details.',
  pre_close:      'Final checks before closing day.',
  closing:        'Signing day is here!',
  post_close:     'Keys are yours. Welcome home!',
};

function JourneyTracker({ deal }: { deal: Deal }) {
  const isFallenThrough = deal.status === 'fallen_through';
  const currentIdx = STAGE_ORDER.indexOf(
    isFallenThrough ? (deal.fellFromStage ?? deal.stage) : deal.stage
  );

  return (
    <div className="rounded-2xl overflow-hidden shadow-sm bg-white">
      {STAGE_ORDER.map((stage, i) => {
        const isPast     = i < currentIdx;
        const isCurrent  = i === currentIdx;
        const isFellHere = isFallenThrough && isCurrent;

        if (isCurrent) {
          return (
            <div key={stage} className={`px-5 py-4 ${isFellHere ? 'bg-gray-800' : 'bg-brand-navy'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${
                    isFellHere ? 'bg-red-400' : 'bg-brand-gold'
                  }`}>
                    {isFellHere
                      ? <XCircle size={15} className="text-white" />
                      : <div className="h-2.5 w-2.5 rounded-full bg-brand-navy" />}
                  </div>
                  <span className="text-base font-black text-white">{BUYER_STAGE_LABELS[stage]}</span>
                </div>
                <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  isFellHere ? 'bg-red-400/20 text-red-300' : 'bg-brand-gold/20 text-brand-gold'
                }`}>
                  {isFellHere ? 'Fell out' : "You're here"}
                </span>
              </div>
              <p className="mt-1.5 ml-[38px] text-xs text-white/60 leading-relaxed">
                {isFellHere
                  ? (deal.fallReason ?? 'This deal has fallen through.')
                  : STAGE_DESCRIPTIONS[stage]}
              </p>
            </div>
          );
        }

        if (isPast) {
          return (
            <div key={stage} className="flex items-center gap-3 px-5 py-2.5 border-b border-gray-50">
              <CheckCircle2 size={13} className="text-green-400 flex-shrink-0" />
              <span className="text-xs font-medium text-green-600">{BUYER_STAGE_LABELS[stage]}</span>
            </div>
          );
        }

        return (
          <div key={stage} className="flex items-center gap-3 px-5 py-2 border-b border-gray-50 last:border-0">
            <Circle size={11} className="text-gray-200 flex-shrink-0" />
            <span className="text-xs text-gray-300">{BUYER_STAGE_LABELS[stage]}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Stage-specific cards ─────────────────────────────────────────────────────

function IntakeCard({ deal, firstName }: { deal: Deal; firstName: string }) {
  const router = useRouter();
  return (
    <div className="rounded-2xl bg-gradient-to-br from-brand-navy to-blue-800 p-5 text-white">
      <p className="text-xs font-bold uppercase tracking-widest text-white/50 mb-1">Getting Started</p>
      <p className="text-xl font-black mb-2">Welcome, {firstName}!</p>
      <p className="text-sm text-white/70 mb-5 leading-relaxed">
        Your agent has set up your home buying portal. Answer a few quick questions to personalize your search — takes about 3 minutes.
      </p>
      <div className="space-y-2 mb-5">
        {['🏠  What you\'re looking for', '💰  Your buying power', '📋  Your personal deal portal'].map((item) => (
          <div key={item} className="flex items-center gap-2 text-sm text-white/75">{item}</div>
        ))}
      </div>
      <button
        onClick={() => router.push(`/onboard/buyer?agent=${deal.agentId}`)}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-gold py-3.5 text-sm font-bold text-brand-navy hover:bg-brand-gold/90 transition-colors"
      >
        Begin my onboarding →
      </button>
    </div>
  );
}

const STATUS_CONFIG: Record<PropertyStatus, { label: string; style: string; next: PropertyStatus }> = {
  interested:       { label: 'Interested',       style: 'bg-blue-100 text-blue-700',    next: 'toured' },
  toured:           { label: 'Toured',           style: 'bg-purple-100 text-purple-700', next: 'not_for_me' },
  not_for_me:       { label: 'Not for me',       style: 'bg-gray-100 text-gray-400',    next: 'interested' },
  offer_submitted:  { label: 'Offer submitted',  style: 'bg-green-100 text-green-700',  next: 'offer_submitted' },
};

function PropertyCard({ property, onStatusChange, onRemove, onBuyerNote, onOfferRequest, canOffer = true }: {
  property: TrackedProperty;
  onStatusChange: (status: PropertyStatus) => void;
  onRemove: () => void;
  onBuyerNote: (note: string) => void;
  onOfferRequest: () => void;
  canOffer?: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewDraft, setReviewDraft] = useState(property.buyerNote ?? '');
  const [offerSent, setOfferSent] = useState(property.offerRequested ?? false);

  const cfg = STATUS_CONFIG[property.status];
  const dimmed = property.status === 'not_for_me';
  const showReviewPrompt = property.status === 'toured' && !property.buyerNote && !reviewOpen;

  function submitReview() {
    const note = reviewDraft.trim();
    if (!note) return;
    onBuyerNote(note);
    setReviewOpen(false);
  }

  function handleOfferRequest() {
    setOfferSent(true);
    onOfferRequest();
  }

  return (
    <div className={`rounded-xl border bg-white overflow-hidden transition-all ${dimmed ? 'opacity-50 border-gray-100' : 'border-gray-200 shadow-sm'}`}>
      <div className="flex gap-3 p-3">
        {/* Thumbnail */}
        <div className="h-20 w-24 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100">
          {property.thumbnailUrl && !imgError ? (
            <Image
              src={property.thumbnailUrl}
              alt={property.address}
              width={96}
              height={80}
              unoptimized
              className="h-full w-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Home size={22} className="text-gray-300" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-1">
            <div className="min-w-0">
              <p className="text-sm font-bold text-brand-navy leading-tight truncate">{property.address}</p>
              <p className="text-xs text-gray-400">{property.city}{property.state ? `, ${property.state}` : ''}</p>
            </div>
            <button onClick={onRemove} className="flex-shrink-0 text-gray-300 hover:text-gray-500 transition-colors mt-0.5">
              <X size={13} />
            </button>
          </div>

          {property.price > 0 && (
            <p className="mt-0.5 text-sm font-black text-brand-navy">${property.price.toLocaleString()}</p>
          )}

          {(property.beds > 0 || property.sqft > 0) && (
            <p className="text-xs text-gray-400">
              {property.beds > 0 && `${property.beds} bd · ${property.baths} ba`}
              {property.sqft > 0 && ` · ${property.sqft.toLocaleString()} sqft`}
            </p>
          )}

          {/* Agent note */}
          {property.addedBy === 'agent' && property.agentNote && (
            <div className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-brand-navy/5 px-2 py-1.5">
              <Star size={10} className="text-brand-gold flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-brand-navy/80 leading-snug">{property.agentNote}</p>
            </div>
          )}
          {property.addedBy === 'agent' && !property.agentNote && (
            <span className="mt-1 inline-block text-[10px] font-bold uppercase tracking-wide text-brand-gold">Agent&apos;s pick</span>
          )}

          {/* Buyer's own note (after review) */}
          {property.buyerNote && !reviewOpen && (
            <div className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-purple-50 px-2 py-1.5">
              <MessageCircle size={10} className="text-purple-400 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-purple-700 leading-snug flex-1">{property.buyerNote}</p>
              <button onClick={() => { setReviewDraft(property.buyerNote ?? ''); setReviewOpen(true); }}
                className="flex-shrink-0 text-gray-300 hover:text-purple-400 transition-colors">
                <Pencil size={10} />
              </button>
            </div>
          )}

          {/* Status + external link row */}
          <div className="mt-2 flex items-center gap-2">
            {property.status !== 'offer_submitted' ? (
              <button
                onClick={() => onStatusChange(cfg.next)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-bold transition-all hover:opacity-80 ${cfg.style}`}
              >
                {cfg.label} ↻
              </button>
            ) : (
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${cfg.style}`}>{cfg.label}</span>
            )}
            {property.sourceUrl && (
              <a href={property.sourceUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-brand-navy transition-colors">
                <ExternalLink size={11} /> View listing
              </a>
            )}
          </div>

          {/* Make an Offer button */}
          {property.status !== 'not_for_me' && (
            <div className="mt-2">
              {!canOffer ? (
                <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2">
                  <AlertCircle size={11} className="text-gray-300 flex-shrink-0" />
                  <p className="text-xs text-gray-400">Pre-approval required to make an offer</p>
                </div>
              ) : offerSent ? (
                <div className="flex items-center gap-1.5 rounded-lg bg-green-50 border border-green-100 px-3 py-2">
                  <CheckCircle2 size={13} className="text-green-500 flex-shrink-0" />
                  <p className="text-xs text-green-700 leading-snug">
                    Your agent has been notified. They&apos;ll reach out to discuss details.
                  </p>
                </div>
              ) : (
                <button
                  onClick={handleOfferRequest}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-gold/90 py-2 text-xs font-bold text-brand-navy hover:bg-brand-gold transition-colors"
                >
                  <Send size={11} /> Make an Offer
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Review prompt — inline below card body */}
      {showReviewPrompt && (
        <div className="border-t border-purple-100 bg-purple-50/60 px-3 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <MessageCircle size={13} className="text-purple-400 flex-shrink-0" />
            <p className="text-xs font-medium text-purple-700">How did it go? Share your thoughts on this home.</p>
          </div>
          <button
            onClick={() => setReviewOpen(true)}
            className="flex-shrink-0 rounded-lg bg-purple-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-purple-600 transition-colors"
          >
            Add thoughts
          </button>
        </div>
      )}

      {/* Review input */}
      {reviewOpen && (
        <div className="border-t border-purple-100 bg-purple-50/60 px-3 py-3 space-y-2">
          <p className="text-xs font-bold text-purple-700">Your thoughts on {property.address}</p>
          <textarea
            autoFocus
            value={reviewDraft}
            onChange={(e) => setReviewDraft(e.target.value)}
            placeholder="What did you think? Layout, neighborhood, deal-breakers…"
            rows={3}
            className="w-full rounded-lg border border-purple-200 bg-white px-3 py-2 text-xs text-gray-800 outline-none focus:border-purple-400 resize-none leading-relaxed"
          />
          <div className="flex gap-2">
            <button
              onClick={submitReview}
              disabled={!reviewDraft.trim()}
              className="flex-1 rounded-lg bg-purple-500 py-2 text-xs font-bold text-white disabled:opacity-40 hover:bg-purple-600 transition-colors"
            >
              Save thoughts
            </button>
            <button
              onClick={() => { setReviewOpen(false); setReviewDraft(property.buyerNote ?? ''); }}
              className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── BAA Signing Modal ────────────────────────────────────────────────────────

function BAASigningModal({ deal, agentId, onClose, onSigned }: {
  deal: Deal;
  agentId: string;
  onClose: () => void;
  onSigned: () => void;
}) {
  const { docsByAgent } = useAgentDocStore();
  const baaDoc = (docsByAgent[agentId] ?? []).find((d) => d.docType === 'baa');
  const [agreed, setAgreed] = useState(false);
  const [signed, setSigned] = useState(false);

  function handleSign() {
    setSigned(true);
    setTimeout(() => { onSigned(); onClose(); }, 1800);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-0">
      <div className="w-full max-w-lg rounded-t-2xl bg-white shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Document</p>
            <h3 className="text-base font-black text-brand-navy">Buyer Agency Agreement</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Document body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-sm text-gray-700 leading-relaxed">
          <div className="rounded-xl bg-gray-50 px-4 py-3 space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-gray-400">Agent</span><span className="font-semibold text-brand-navy">Sarah Johnson</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Buyer</span><span className="font-semibold text-brand-navy">{deal.clientName}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Agreement Date</span><span className="font-semibold text-brand-navy">{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">Duration</span><span className="font-semibold text-brand-navy">90 days from signing</span></div>
            {baaDoc?.notes && <div className="flex justify-between"><span className="text-gray-400">Notes</span><span className="font-medium text-brand-navy">{baaDoc.notes}</span></div>}
          </div>

          <p><strong>1. Exclusive Representation.</strong> Buyer agrees to work exclusively with Agent for the purpose of locating and purchasing residential real property during the term of this agreement.</p>
          <p><strong>2. Agent&apos;s Duties.</strong> Agent agrees to use reasonable efforts to assist Buyer in locating suitable properties, presenting offers, and negotiating on Buyer&apos;s behalf.</p>
          <p><strong>3. Buyer&apos;s Duties.</strong> Buyer agrees to work exclusively with Agent and to notify Agent of any properties discovered through independent sources.</p>
          <p><strong>4. Compensation.</strong> Agent&apos;s compensation is negotiated separately and will be disclosed in each purchase agreement.</p>
          <p><strong>5. Termination.</strong> Either party may terminate this agreement with written notice. Properties introduced by Agent during the term remain subject to this agreement for 60 days post-termination.</p>
          <p className="text-xs text-gray-400 border-t border-gray-100 pt-3">
            This is a placeholder template. In production, the agent&apos;s uploaded document will be displayed here for electronic signature via DocuSign or a similar service.
          </p>
        </div>

        {/* Sign footer */}
        <div className="border-t border-gray-100 px-5 py-4 space-y-3">
          {!signed ? (
            <>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-navy" />
                <span className="text-xs text-gray-600 leading-relaxed">
                  I have read and agree to the terms of this Buyer Agency Agreement.
                </span>
              </label>
              <button
                onClick={handleSign}
                disabled={!agreed}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-navy py-3.5 text-sm font-bold text-white disabled:opacity-40 hover:bg-brand-navy/90 transition-all"
              >
                Sign electronically →
              </button>
            </>
          ) : (
            <div className="flex items-center justify-center gap-2 py-3">
              <CheckCircle2 size={20} className="text-green-500" />
              <p className="text-sm font-bold text-green-700">Agreement signed! Closing…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── MLS Browser ─────────────────────────────────────────────────────────────

function MLSListingCard({ listing, onAdd }: { listing: MLSListing; onAdd: (l: MLSListing) => void }) {
  const photo = listing.photos?.[0];
  const price = listing.listPrice > 0
    ? `$${listing.listPrice.toLocaleString()}`
    : 'Price unavailable';
  const beds = listing.property.bedrooms;
  const baths = listing.property.bathsFull;
  const sqft = listing.property.area > 0 ? Math.round(listing.property.area).toLocaleString() : null;
  const dom = listing.mls.daysOnMarket;

  return (
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden shadow-sm">
      {photo ? (
        <Image src={photo} alt={listing.address.full} width={400} height={144} unoptimized className="w-full h-36 object-cover" />
      ) : (
        <div className="w-full h-36 bg-gray-100 flex items-center justify-center">
          <Home size={24} className="text-gray-300" />
        </div>
      )}
      <div className="p-3">
        <div className="flex items-start justify-between gap-1">
          <div>
            <p className="font-black text-brand-navy text-sm leading-tight">{price}</p>
            <p className="text-xs text-gray-500 mt-0.5 leading-tight truncate">{listing.address.full}</p>
            <p className="text-xs text-gray-400">{listing.address.city}, {listing.address.state}</p>
          </div>
          {dom <= 7 && (
            <span className="flex-shrink-0 rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-bold text-green-700 uppercase">
              New
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-2 text-[11px] text-gray-500">
          {beds > 0 && <span>{beds} bd</span>}
          {baths > 0 && <span>· {baths} ba</span>}
          {sqft && <span>· {sqft} sqft</span>}
          <span className="ml-auto text-gray-300">{dom}d</span>
        </div>
        <button
          onClick={() => onAdd(listing)}
          className="mt-2 w-full rounded-lg bg-brand-navy/5 py-1.5 text-xs font-semibold text-brand-navy hover:bg-brand-navy/10 transition-colors"
        >
          + Add to my list
        </button>
      </div>
    </div>
  );
}

function MLSBrowser({ deal, onAddProperty }: {
  deal: Deal;
  onAddProperty: (address: string, city: string, price: number, sourceUrl?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [cityInput, setCityInput] = useState(deal.property.city ?? '');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minBeds, setMinBeds] = useState('');
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const { listings, loading, error, search } = useMLSListings(deal.id);

  function handleSearch() {
    search({
      cities: cityInput.trim() ? [cityInput.trim()] : undefined,
      minPrice: minPrice ? parseInt(minPrice.replace(/\D/g, ''), 10) : undefined,
      maxPrice: maxPrice ? parseInt(maxPrice.replace(/\D/g, ''), 10) : undefined,
      minBeds: minBeds ? parseInt(minBeds, 10) : undefined,
    });
  }

  function handleAdd(l: MLSListing) {
    onAddProperty(l.address.full, l.address.city, l.listPrice);
    setAddedIds((prev) => new Set(prev).add(l.mlsId));
  }

  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <Building2 size={15} className="text-brand-navy" />
          <span className="text-sm font-bold text-brand-navy">Browse live MLS listings</span>
        </div>
        <span className="text-xs text-gray-400">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-gray-50 px-4 pb-4">
          {/* Search filters */}
          <div className="pt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                value={cityInput}
                onChange={(e) => setCityInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="City"
                className="col-span-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800 outline-none focus:border-brand-navy/30"
              />
              <input
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                placeholder="Min price"
                className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800 outline-none focus:border-brand-navy/30"
              />
              <input
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                placeholder="Max price"
                className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800 outline-none focus:border-brand-navy/30"
              />
              <select
                value={minBeds}
                onChange={(e) => setMinBeds(e.target.value)}
                className="col-span-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800 outline-none focus:border-brand-navy/30"
              >
                <option value="">Any bedrooms</option>
                <option value="1">1+ bed</option>
                <option value="2">2+ beds</option>
                <option value="3">3+ beds</option>
                <option value="4">4+ beds</option>
              </select>
            </div>
            <button
              onClick={handleSearch}
              disabled={loading}
              className="w-full rounded-lg bg-brand-navy py-2 text-xs font-bold text-white hover:bg-brand-navy/90 transition-colors disabled:opacity-50"
            >
              {loading ? 'Searching…' : 'Search listings'}
            </button>
          </div>

          {error && (
            <p className="mt-3 text-xs text-red-500">{error === 'agent has not connected MLS' ? 'Your agent hasn\'t connected their MLS yet.' : error}</p>
          )}

          {listings.length > 0 && (
            <div className="mt-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">
                {listings.length} listing{listings.length !== 1 ? 's' : ''} found
              </p>
              <div className="grid grid-cols-2 gap-3">
                {listings.map((l) => (
                  addedIds.has(l.mlsId) ? (
                    <div key={l.mlsId} className="rounded-xl border border-green-200 bg-green-50 p-3 flex items-center justify-center">
                      <span className="flex items-center gap-1 text-xs font-semibold text-green-700">
                        <CheckCircle2 size={13} /> Added
                      </span>
                    </div>
                  ) : (
                    <MLSListingCard key={l.mlsId} listing={l} onAdd={handleAdd} />
                  )
                ))}
              </div>
            </div>
          )}

          {!loading && !error && listings.length === 0 && (
            <p className="mt-3 text-center text-xs text-gray-300">Search above to see live listings</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Active Search Card ───────────────────────────────────────────────────────

function ActiveSearchCard({ deal, onBaaSigned }: { deal: Deal; onBaaSigned?: () => void }) {
  const { properties, addProperty, updateStatus, removeProperty, updateBuyerNote, setOfferRequested } = useProperties(deal.id);
  const preApproved = deal.preApproved ?? false;
  const baaSigned = deal.baaSigned ?? false;

  async function handleOfferInterest(propertyId: string, _address: string) {
    await setOfferRequested(propertyId, true).catch(() => {});
  }
  const [showBAAModal, setShowBAAModal] = useState(false);
  const isMountainMortgage = deal.flags.includes('mountain_mortgage');

  const [showForm, setShowForm] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [priceInput, setPriceInput] = useState('');

  async function handleAdd() {
    const addr = addressInput.trim() || (urlInput.trim() ? 'Property from link' : '');
    if (!addr) return;
    await addProperty({
      dealId: deal.id,
      address: addr,
      city: '', state: '',
      price: priceInput ? parseInt(priceInput.replace(/\D/g, ''), 10) : 0,
      beds: 0, baths: 0, sqft: 0,
      thumbnailUrl: '',
      sourceUrl: urlInput.trim(),
      status: 'interested',
      addedBy: 'buyer',
    }).catch(() => {});
    setUrlInput(''); setAddressInput(''); setPriceInput('');
    setShowForm(false);
  }

  function handleUploadLetter() {
    // Pre-approval flag is set by the agent — this is informational
  }

  function handleLetterLater() {
    // Pre-approval flag is set by the agent — this is informational
  }

  return (
    <div className="space-y-3">
      {/* Header + add form */}
      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4">
        <div className="mb-3">
          <h3 className="text-base font-black text-brand-navy">Your Home Search</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {properties.length === 0
              ? 'No properties tracked yet'
              : `${properties.length} propert${properties.length === 1 ? 'y' : 'ies'} tracked`}
          </p>
        </div>

        {!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-3 text-sm font-semibold text-gray-400 hover:border-brand-navy/30 hover:text-brand-navy transition-all"
          >
            <Plus size={15} /> Add a property
          </button>
        ) : (
          <div className="rounded-xl border border-brand-navy/20 bg-brand-navy/5 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <LinkIcon size={13} className="text-gray-400 flex-shrink-0" />
              <input autoFocus type="text" value={urlInput} onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Paste a Zillow or MLS link (optional)"
                className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 outline-none focus:border-brand-navy/30" />
            </div>
            <input type="text" value={addressInput} onChange={(e) => setAddressInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="Address  e.g. 123 Oak St, Hoover, AL"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 outline-none focus:border-brand-navy/30" />
            <input type="text" value={priceInput} onChange={(e) => setPriceInput(e.target.value)}
              placeholder="List price (optional)"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-800 outline-none focus:border-brand-navy/30" />
            <div className="flex gap-2">
              <button onClick={handleAdd} disabled={!addressInput.trim() && !urlInput.trim()}
                className="flex-1 rounded-lg bg-brand-navy py-2 text-xs font-bold text-white disabled:opacity-40 hover:bg-brand-navy/80 transition-colors">
                Add property
              </button>
              <button onClick={() => { setShowForm(false); setUrlInput(''); setAddressInput(''); setPriceInput(''); }}
                className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-500 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Pre-approval banner — visible above the list, not blocking it */}
      {!preApproved && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-amber-100">
              <AlertCircle size={16} className="text-amber-600" />
            </div>
            <div>
              <p className="text-sm font-black text-amber-900">Get pre-approved to make an offer</p>
              <p className="mt-0.5 text-xs text-amber-700 leading-relaxed">
                Browse homes your agent has shared below. You&apos;ll need a pre-approval letter before we can submit an offer.
              </p>
            </div>
          </div>

          {!baaSigned && (
            <button
              onClick={() => setShowBAAModal(true)}
              className="flex w-full items-center justify-between rounded-xl border border-amber-300 bg-white px-4 py-3 text-left hover:bg-amber-50 transition-colors"
            >
              <div>
                <p className="text-sm font-bold text-brand-navy">Sign your buyer agency agreement</p>
                <p className="text-xs text-gray-400 mt-0.5">Required before your agent can legally show you homes</p>
              </div>
              <ChevronRight size={16} className="text-brand-navy flex-shrink-0" />
            </button>
          )}

          {baaSigned && (
            <div className="mb-1 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2.5">
              <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
              <p className="text-xs font-semibold text-green-800">Buyer agency agreement signed</p>
            </div>
          )}

          {isMountainMortgage ? (
            <div className="flex gap-2">
              <a href="tel:+12054019076"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-navy py-2.5 text-xs font-bold text-white hover:bg-brand-navy/90 transition-colors">
                <Phone size={12} /> Call Paul Leara
              </a>
              <a href="https://apply.mountainmortgage.com" target="_blank" rel="noopener noreferrer"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border-2 border-brand-navy py-2.5 text-xs font-bold text-brand-navy hover:bg-brand-navy/5 transition-colors">
                <ExternalLink size={12} /> Apply Now →
              </a>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={handleUploadLetter}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-navy py-2.5 text-xs font-bold text-white hover:bg-brand-navy/90 transition-colors">
                Upload pre-approval letter
              </button>
              <button onClick={handleLetterLater}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-2.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
                I have one — send later
              </button>
            </div>
          )}
        </div>
      )}

      {/* Property list — always visible */}
      <div className="space-y-3">
        {properties.length === 0 && !showForm && (
          <div className="rounded-2xl border border-dashed border-gray-200 px-5 py-8 text-center">
            <Home size={28} className="mx-auto mb-2 text-gray-200" />
            <p className="text-sm font-semibold text-gray-400">No properties yet</p>
            <p className="mt-1 text-xs text-gray-300">
              Paste a link or type an address above. Your agent can also push listings to your portal.
            </p>
          </div>
        )}
        {properties.map((prop) => (
          <PropertyCard key={prop.id} property={prop}
            canOffer={preApproved}
            onStatusChange={(status) => updateStatus(prop.id, status)}
            onRemove={() => removeProperty(prop.id)}
            onBuyerNote={(note) => updateBuyerNote(prop.id, note)}
            onOfferRequest={() => handleOfferInterest(prop.id, prop.address)} />
        ))}
      </div>

      {/* Live MLS listings browser */}
      <MLSBrowser
        deal={deal}
        onAddProperty={(address, city, price) =>
          addProperty({
            dealId: deal.id,
            address,
            city,
            state: '',
            price,
            beds: 0, baths: 0, sqft: 0,
            thumbnailUrl: '',
            sourceUrl: '',
            status: 'interested',
            addedBy: 'buyer',
          }).catch(() => {})
        }
      />

      {/* BAA signing modal */}
      {showBAAModal && (
        <BAASigningModal
          deal={deal}
          agentId={deal.agentId}
          onClose={() => setShowBAAModal(false)}
          onSigned={() => {
            api.post(`/deals/${deal.id}/baa/sign`, {}).catch(() => {});
            onBaaSigned?.();
          }}
        />
      )}
    </div>
  );
}

function OfferActiveCard({ deal }: { deal: Deal }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-amber-100">
          <ClipboardList size={18} className="text-amber-600" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-amber-900 text-sm">Your offer is submitted</p>
          <p className="mt-0.5 text-xs text-amber-700">
            {deal.property.address}, {deal.property.city}
          </p>
          <p className="mt-2 text-lg font-black text-amber-900">
            ${deal.property.price.toLocaleString()}
          </p>
        </div>
        <span className="rounded-full bg-amber-200 px-2.5 py-1 text-[10px] font-bold text-amber-800 uppercase">
          Pending
        </span>
      </div>
      <div className="mt-4 rounded-xl bg-white/60 px-4 py-3">
        <p className="text-xs font-semibold text-amber-800">Stay available</p>
        <p className="mt-0.5 text-xs text-amber-600 leading-relaxed">
          Your agent may need a quick response if the seller counters. Keep your phone nearby.
        </p>
      </div>
    </div>
  );
}

const APPRAISAL_CONFIG: Record<
  NonNullable<NonNullable<Deal['loanMilestones']>['appraisal']>,
  { icon: string; label: string; cardCls: string; textCls: string; subCls: string; desc: string }
> = {
  pending: {
    icon: '⏳', label: 'Pending',
    cardCls: 'bg-gray-50 border-gray-200', textCls: 'text-gray-700', subCls: 'text-gray-500',
    desc: 'Your lender will order the appraisal shortly after going under contract.',
  },
  ordered: {
    icon: '📋', label: 'Ordered',
    cardCls: 'bg-blue-50 border-blue-100', textCls: 'text-blue-800', subCls: 'text-blue-600',
    desc: 'Appraisal has been ordered. The lender will reach out to coordinate property access.',
  },
  scheduled: {
    icon: '📅', label: 'Scheduled',
    cardCls: 'bg-amber-50 border-amber-200', textCls: 'text-amber-800', subCls: 'text-amber-600',
    desc: 'Appraisal is scheduled. Make sure the seller or agent can provide access on the agreed date.',
  },
  complete: {
    icon: '✅', label: 'Complete',
    cardCls: 'bg-green-50 border-green-200', textCls: 'text-green-800', subCls: 'text-green-600',
    desc: 'Appraisal is done and results have been submitted to your lender.',
  },
};

function UnderContractCard({ deal }: { deal: Deal }) {
  // disclosuresOut / disclosuresSignedSubmitted are the correct field names
  const hasDisclosureUrgent =
    deal.loanMilestones?.disclosuresOut === true &&
    deal.loanMilestones?.disclosuresSignedSubmitted === false;

  const lender    = deal.vendors?.lender;
  const inspector = deal.vendors?.inspector;
  const appraisal = deal.loanMilestones?.appraisal ?? null;
  const hasRepairRequest = deal.flags.includes('repair_request');

  return (
    <div className="space-y-3">
      {/* Urgent: disclosures */}
      {hasDisclosureUrgent && (
        <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
          <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-700">Action required: Sign your disclosures</p>
            <p className="text-xs text-red-400 mt-0.5 leading-relaxed">
              {lender
                ? `${lender.company} sent disclosures to your email. Open their portal to sign — must be completed within 3 business days.`
                : 'Your lender sent disclosures to your email. Sign through their portal within 3 business days.'}
            </p>
            {lender?.portalUrl && (
              <a
                href={lender.portalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 transition-colors"
              >
                <ExternalLink size={11} /> Open {lender.company} Portal
              </a>
            )}
          </div>
        </div>
      )}

      {/* Closing countdown */}
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

      {/* Inspector card */}
      {inspector && (
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Your Inspector</p>
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-teal-50">
              <ClipboardList size={18} className="text-teal-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-brand-navy">{inspector.company}</p>
              {inspector.contactName && (
                <p className="text-xs text-gray-400">{inspector.contactName}</p>
              )}
            </div>
          </div>
          <div className="space-y-2">
            {inspector.phone && (
              <a href={`tel:${inspector.phone}`}
                className="flex items-center gap-2.5 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 transition-colors">
                <Phone size={14} /> {inspector.phone}
              </a>
            )}
            {inspector.email && (
              <a href={`mailto:${inspector.email}`}
                className="flex items-center gap-2.5 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 transition-colors">
                <Mail size={14} /> {inspector.email}
              </a>
            )}
          </div>
          <div className="mt-3 rounded-lg bg-teal-50 border border-teal-100 px-3 py-2.5">
            <p className="text-xs font-semibold text-teal-700">💡 Attend your inspection</p>
            <p className="text-xs text-teal-600 mt-0.5 leading-relaxed">
              Being there in person lets you ask questions and understand the home&apos;s condition before you close — highly recommended.
            </p>
          </div>
        </div>
      )}

      {/* Appraisal status */}
      {appraisal && (() => {
        const cfg = APPRAISAL_CONFIG[appraisal];
        return (
          <div className={`rounded-xl border px-4 py-3.5 ${cfg.cardCls}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-base leading-none">{cfg.icon}</span>
                <p className={`text-sm font-bold ${cfg.textCls}`}>Appraisal: {cfg.label}</p>
              </div>
              <span className={`text-[11px] font-bold uppercase tracking-wide ${cfg.subCls}`}>{cfg.label}</span>
            </div>
            <p className={`mt-1.5 text-xs leading-relaxed ml-7 ${cfg.subCls}`}>{cfg.desc}</p>
          </div>
        );
      })()}

      {/* Repair request — buyer-facing explanation */}
      {hasRepairRequest && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3.5">
          <div className="flex items-start gap-2.5">
            <AlertCircle size={16} className="text-orange-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-orange-800">Repair request submitted</p>
              <p className="text-xs text-orange-600 mt-0.5 leading-relaxed">
                Your agent submitted a repair request to the seller after the inspection. The seller&apos;s agent is reviewing it — your agent will update you once they respond.
              </p>
              <p className="text-xs text-orange-500 mt-1.5 leading-relaxed italic">
                Typical response time: 3–5 business days. Stay available for questions.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Full metro map */}
      <MetroMap deal={deal} />
    </div>
  );
}

function PreCloseCard({ deal }: { deal: Deal }) {
  const items = [
    { label: 'Schedule final walkthrough',  done: false },
    { label: 'Review Closing Disclosure',   done: false },
    { label: 'Confirm wire instructions',   done: false },
    { label: 'Prepare ID + funds',          done: false },
  ];
  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
      <div className="bg-blue-50 border-b border-blue-100 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Star size={15} className="text-blue-600" />
          <span className="text-sm font-bold text-blue-800">Almost there!</span>
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
        <div className="mt-3 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2.5">
          <p className="text-[11px] font-semibold text-amber-700">Wire fraud warning</p>
          <p className="text-[11px] text-amber-600 mt-0.5 leading-relaxed">
            Never wire funds based on email instructions. Call your agent or title company directly to verify.
          </p>
        </div>
      </div>
    </div>
  );
}

function ClosingCard() {
  const checklist = [
    'Government-issued photo ID',
    'Cashier\'s check or wire confirmation',
    'Any remaining documents requested',
    'Your phone (charged)',
  ];
  return (
    <div className="rounded-2xl overflow-hidden">
      <div className="bg-brand-gold px-5 py-4">
        <p className="text-xs font-bold uppercase tracking-widest text-brand-navy/60">Closing Day</p>
        <p className="text-xl font-black text-brand-navy mt-0.5">Today&apos;s the day!</p>
        <p className="text-sm text-brand-navy/70 mt-1">Here&apos;s what to bring to the closing table.</p>
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
            Your agent will be there with you. Questions? Call Sarah before you leave.
          </p>
        </div>
      </div>
    </div>
  );
}

function PostCloseCard({ deal, firstName }: { deal: Deal; firstName: string }) {
  const hasFastPass = deal.flags.includes('fast_pass');
  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 p-5 text-white">
        <div className="flex items-center gap-2 mb-2">
          <Home size={20} className="text-white" />
          <p className="text-xs font-bold uppercase tracking-widest text-white/70">You own it!</p>
        </div>
        <p className="text-xl font-black">Congratulations, {firstName}!</p>
        <p className="text-sm text-white/80 mt-1">{deal.property.address} is yours.</p>
      </div>
      {hasFastPass && (
        <div className="rounded-2xl border border-green-200 bg-green-50 px-5 py-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap size={15} className="text-green-600" />
            <p className="text-sm font-bold text-green-800">Fast Pass team is on it</p>
          </div>
          <p className="text-xs text-green-600 leading-relaxed">
            Your concierge team is coordinating utilities, movers, and your welcome home package.
          </p>
        </div>
      )}
      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-3">Next Steps</p>
        <div className="space-y-2.5">
          {[
            { icon: Building2, label: 'Transfer utilities into your name' },
            { icon: Mail,      label: 'Update your mailing address' },
            { icon: Home,      label: 'Check HOA welcome packet (if applicable)' },
            { icon: Star,      label: 'Leave a review for your agent' },
          ].map(({ icon: Icon, label }, i) => (
            <div key={i} className="flex items-center gap-3">
              <Icon size={14} className="text-gray-400 flex-shrink-0" />
              <span className="text-sm text-gray-600">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Lender card ─────────────────────────────────────────────────────────────

function LenderCard({ deal }: { deal: Deal }) {
  const lender = deal.vendors?.lender;
  if (!lender) return null;

  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5">
      <p className="mb-3 text-xs font-bold uppercase tracking-widest text-gray-400">Your Lender</p>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50">
          <Building2 size={18} className="text-blue-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-brand-navy">{lender.company}</p>
          {lender.loanOfficer && (
            <p className="text-xs text-gray-400">LO: {lender.loanOfficer}</p>
          )}
        </div>
        {lender.isAriveIntegrated && (
          <span className="rounded-full bg-blue-50 border border-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-600 uppercase tracking-wide">
            ARIVE
          </span>
        )}
      </div>
      <div className="space-y-2">
        {lender.phone && (
          <a href={`tel:${lender.phone}`}
            className="flex items-center gap-2.5 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 transition-colors">
            <Phone size={14} /> {lender.phone}
          </a>
        )}
        {lender.email && (
          <a href={`mailto:${lender.email}`}
            className="flex items-center gap-2.5 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 transition-colors">
            <Mail size={14} /> {lender.email}
          </a>
        )}
        {lender.portalUrl && (
          <a
            href={lender.portalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-lg bg-brand-navy px-3 py-2.5 text-sm font-bold text-white hover:bg-brand-navy/80 transition-colors"
          >
            <ExternalLink size={14} /> Open {lender.company} Portal
          </a>
        )}
      </div>
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
      <div className="rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4">
        <p className="text-sm font-bold text-blue-800 mb-1">What happens next</p>
        <p className="text-xs text-blue-600 leading-relaxed">
          This doesn&apos;t mean the end of your home search. Your agent will reach out to discuss
          your options — whether that&apos;s a different lender, a different property, or another approach.
        </p>
        <div className="mt-3 flex gap-2">
          <a href="tel:+12055550100"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 transition-colors">
            <Phone size={12} /> Call Agent
          </a>
          <a href="mailto:sarah@realtourflow.com"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 transition-colors">
            <Mail size={12} /> Email Agent
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Fast Pass service tracker (enrolled buyers) ─────────────────────────────

type FPStatus = 'pending' | 'scheduled' | 'in_progress' | 'complete';

const FP_STATUS_CFG: Record<FPStatus, { label: string; dotCls: string; textCls: string; badgeCls: string }> = {
  pending:     { label: 'Pending',     dotCls: 'bg-gray-300',  textCls: 'text-gray-400',   badgeCls: 'bg-gray-100 text-gray-500' },
  scheduled:   { label: 'Scheduled',   dotCls: 'bg-amber-400', textCls: 'text-amber-700',  badgeCls: 'bg-amber-100 text-amber-700' },
  in_progress: { label: 'In Progress', dotCls: 'bg-blue-400',  textCls: 'text-blue-700',   badgeCls: 'bg-blue-100 text-blue-700' },
  complete:    { label: 'Complete',    dotCls: 'bg-green-400', textCls: 'text-green-700',  badgeCls: 'bg-green-100 text-green-700' },
};

const FP_STAGE_IDX: Record<DealStage, number> = {
  intake: 0, active_search: 1, offer_active: 2,
  under_contract: 3, pre_close: 4, closing: 5, post_close: 6,
};

function fpStatusAt(stage: DealStage, thresholds: {
  scheduled?: DealStage; in_progress?: DealStage; complete?: DealStage;
}): FPStatus {
  const i = FP_STAGE_IDX[stage];
  if (thresholds.complete   && i >= FP_STAGE_IDX[thresholds.complete])   return 'complete';
  if (thresholds.in_progress && i >= FP_STAGE_IDX[thresholds.in_progress]) return 'in_progress';
  if (thresholds.scheduled  && i >= FP_STAGE_IDX[thresholds.scheduled])  return 'scheduled';
  return 'pending';
}

// Base services included with every Fast Pass, with stage-threshold rules
const FP_BASE_SERVICES: { name: string; thresholds: Parameters<typeof fpStatusAt>[1] }[] = [
  { name: 'Dedicated concierge assigned',           thresholds: { in_progress: 'active_search', complete: 'under_contract' } },
  { name: 'Title & insurance admin coordination',   thresholds: { in_progress: 'under_contract', complete: 'closing' } },
  { name: 'Move-in timeline & scheduling',          thresholds: { scheduled: 'pre_close', in_progress: 'closing', complete: 'post_close' } },
  { name: 'Interior designer move-in consult',      thresholds: { scheduled: 'pre_close', in_progress: 'closing', complete: 'post_close' } },
  { name: '2% refi credit — active post-close',     thresholds: { scheduled: 'pre_close', complete: 'post_close' } },
];

// Per-upsell stage thresholds
const FP_UPSELL_THRESHOLDS: Record<FastPassUpsellId, Parameters<typeof fpStatusAt>[1]> = {
  utility_setup:       { scheduled: 'pre_close', in_progress: 'closing',  complete: 'post_close' },
  deep_clean:          { scheduled: 'pre_close', in_progress: 'closing',  complete: 'post_close' },
  moving_coordination: { scheduled: 'pre_close', in_progress: 'closing',  complete: 'post_close' },
  refi_monitoring:     { scheduled: 'closing',   in_progress: 'post_close', complete: 'post_close' },
  home_warranty:       { scheduled: 'pre_close', in_progress: 'closing',  complete: 'post_close' },
  inspection_followup: { in_progress: 'under_contract', complete: 'pre_close' },
  address_change:      { scheduled: 'closing',   in_progress: 'post_close', complete: 'post_close' },
  storage_research:    { in_progress: 'pre_close', complete: 'closing' },
  new_construction:    { scheduled: 'pre_close', in_progress: 'closing',  complete: 'post_close' },
  staging_consult:     { scheduled: 'pre_close', in_progress: 'closing',  complete: 'post_close' },
};

function FastPassTracker({ deal }: { deal: Deal }) {
  const fp = deal.fastPass;
  if (!fp) return null;

  const stage = deal.stage;
  const moveDate = fp.surveyAnswers?.targetMoveDate;
  const selectedUpsells = fp.selectedUpsells ?? [];
  const enrolledUpsells = FAST_PASS_UPSELLS.filter((u) => selectedUpsells.includes(u.id));

  const allServices = [
    ...FP_BASE_SERVICES.map((s) => ({
      name: s.name,
      status: fpStatusAt(stage, s.thresholds),
      isUpsell: false,
    })),
    ...enrolledUpsells.map((u) => ({
      name: u.name,
      status: fpStatusAt(stage, FP_UPSELL_THRESHOLDS[u.id]),
      isUpsell: true,
    })),
  ];

  const doneCount = allServices.filter((s) => s.status === 'complete').length;

  return (
    <div className="rounded-2xl overflow-hidden border border-green-200 bg-white">
      {/* Header */}
      <div className="bg-green-700 px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-green-200" />
            <span className="text-sm font-black text-white">Fast Pass</span>
          </div>
          <span className="rounded-full bg-green-600 px-2.5 py-0.5 text-[11px] font-bold text-green-100">
            Active
          </span>
        </div>
        <p className="mt-1.5 text-xs text-green-200/80 leading-relaxed">
          Your concierge is coordinating everything below.
          {moveDate && ` Target move-in: ${moveDate}.`}
        </p>
        <div className="mt-2.5 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-green-600 overflow-hidden">
            <div
              className="h-full rounded-full bg-green-300 transition-all"
              style={{ width: `${Math.round((doneCount / allServices.length) * 100)}%` }}
            />
          </div>
          <span className="text-[11px] font-bold text-green-200">
            {doneCount}/{allServices.length} done
          </span>
        </div>
      </div>

      {/* Service list */}
      <div className="divide-y divide-gray-50">
        {allServices.map((svc, i) => {
          const cfg = FP_STATUS_CFG[svc.status];
          return (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className={`h-2 w-2 flex-shrink-0 rounded-full ${cfg.dotCls}`} />
              <span className={`flex-1 text-sm ${svc.status === 'complete' ? 'line-through text-gray-300' : 'text-gray-700'}`}>
                {svc.name}
                {svc.isUpsell && (
                  <span className="ml-1.5 text-[10px] font-bold text-green-600 uppercase tracking-wide">Add-on</span>
                )}
              </span>
              <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${cfg.badgeCls}`}>
                {cfg.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Footer CTA */}
      <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 flex items-center justify-between gap-3">
        <p className="text-xs text-gray-400">Questions about your Fast Pass?</p>
        <a
          href="tel:+12054019076"
          className="flex items-center gap-1.5 rounded-lg bg-green-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-800 transition-colors"
        >
          <Phone size={11} /> Call concierge
        </a>
      </div>
    </div>
  );
}

// ─── Fast Pass pitch card (unenrolled buyers) ─────────────────────────────────

function FastPassPitch() {
  const router = useRouter();
  return (
    <div className="rounded-2xl overflow-hidden border-2 border-green-200 bg-green-50">
      <div className="p-5">
        <div className="flex items-center gap-2 mb-2">
          <Zap size={15} className="text-green-600" />
          <span className="text-xs font-bold uppercase tracking-widest text-green-600">Buyer Concierge</span>
        </div>
        <div className="text-lg font-black text-green-900">Fast Pass</div>
        <p className="mt-1.5 text-sm text-green-800/80 leading-relaxed">
          We handle your move-in coordination — movers, utilities, deep clean, address changes, and more. Close on Thursday, wake up home on Saturday.
        </p>
        <div className="mt-3 inline-block rounded-lg bg-green-100 px-3 py-1.5 text-sm font-black text-green-800">
          $1,497 · pay now or at closing
        </div>
      </div>
      <div className="border-t border-green-200 px-5 py-3 flex items-center gap-3">
        <button
          onClick={() => router.push('/fast-pass')}
          className="text-xs font-semibold text-green-700 hover:text-green-900 transition-colors"
        >
          Learn more →
        </button>
        <button
          onClick={() => router.push('/fast-pass/survey')}
          className="ml-auto rounded-xl bg-green-700 px-5 py-2 text-xs font-bold text-white hover:bg-green-800 transition-colors active:scale-[0.98]"
        >
          Get Started
        </button>
      </div>
    </div>
  );
}

// ─── Stage card dispatcher ────────────────────────────────────────────────────

function StageCard({ deal, firstName, onRefresh }: { deal: Deal; firstName: string; onRefresh?: () => void }) {
  if (deal.status === 'fallen_through') return <FallenThroughCard deal={deal} firstName={firstName} />;
  switch (deal.stage) {
    case 'intake':         return <IntakeCard deal={deal} firstName={firstName} />;
    case 'active_search':  return <ActiveSearchCard deal={deal} onBaaSigned={onRefresh} />;
    case 'offer_active':   return <OfferActiveCard deal={deal} />;
    case 'under_contract': return <UnderContractCard deal={deal} />;
    case 'pre_close':      return <PreCloseCard deal={deal} />;
    case 'closing':        return <ClosingCard />;
    case 'post_close':     return <PostCloseCard deal={deal} firstName={firstName} />;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function BuyerView() {
  const activeUser = useAuthStore((s) => s.activeUser);
  const [activeTab, setActiveTab] = useState<Tab>('tasks');
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());

  const { deals, loading: dealsLoading, refresh: refreshDeals } = useMyDeals();
  const deal = deals.find((d) => d.type === 'buy');
  const { tasks } = useTasks(deal?.id ?? '');
  const buyerTasks = tasks.filter((t) => t.assignedTo === 'buyer');
  const openTasks = buyerTasks.filter((t) => t.status !== 'completed' && !completedIds.has(t.id));

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
      <ClientNotifications />

      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-brand-navy">
          {isFallenThrough ? `Hi, ${firstName}` : `Hi, ${firstName}!`}
        </h1>
        <div className={`mt-3 rounded-2xl bg-white shadow-sm p-4 ${
          isFallenThrough ? 'border-l-4 border-l-gray-400' :
          deal.health === 'green' ? 'border-l-4 border-l-green-400' :
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
              {deal.fastPass?.status === 'active' && (
                <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-green-100 border border-green-200 px-2 py-0.5 text-[11px] font-bold text-green-700">
                  <Zap size={10} /> Fast Pass Active
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
                {isFallenThrough ? 'Fell Through' : BUYER_STAGE_LABELS[deal.stage]}
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

      {/* Overdue alert — right after header, before journey */}
      {!isFallenThrough && buyerTasks.some((t) => t.status === 'overdue') && (
        <div className="flex items-center gap-3 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
          <AlertCircle size={18} className="text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-700">You have overdue tasks</p>
            <p className="text-xs text-red-400">Your agent is waiting — take a look below</p>
          </div>
        </div>
      )}

      {/* Journey tracker */}
      <div className={!isFallenThrough && buyerTasks.some((t) => t.status === 'overdue') ? 'pt-6' : ''}>
        <JourneyTracker deal={deal} />
      </div>

      {/* Stage-specific card */}
      <StageCard deal={deal} firstName={firstName} onRefresh={refreshDeals} />

      {/* Fast Pass tracker (enrolled) or pitch (unenrolled) */}
      {!isFallenThrough && deal.stage !== 'intake' && (
        deal.fastPass?.status === 'active'
          ? <FastPassTracker deal={deal} />
          : deal.stage !== 'post_close' && <FastPassPitch />
      )}

      {/* Tabs (hide on post-close and fallen-through to keep it clean) */}
      {!isFallenThrough && deal.stage !== 'post_close' && (
        <>
          <div className="pt-6" />
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
                  <p className="text-sm font-medium text-gray-500">All caught up — great work!</p>
                </div>
              )}
              {openTasks.filter((t) => t.status === 'overdue').map((t) => <TaskCard key={t.id} task={t} onComplete={handleComplete} />)}
              {openTasks.filter((t) => t.status === 'in_progress').map((t) => <TaskCard key={t.id} task={t} onComplete={handleComplete} />)}
              {openTasks.filter((t) => t.status === 'pending').map((t) => <TaskCard key={t.id} task={t} onComplete={handleComplete} />)}
              {(buyerTasks.filter((t) => t.status === 'completed').length + completedIds.size) > 0 && (
                <p className="text-center text-xs text-gray-300 pt-1">
                  {buyerTasks.filter((t) => t.status === 'completed').length + completedIds.size} task{(buyerTasks.filter((t) => t.status === 'completed').length + completedIds.size) !== 1 ? 's' : ''} completed
                </p>
              )}
            </div>
          )}
          {activeTab === 'messages' && <MessagesTab dealId={deal.id} />}
          {activeTab === 'documents' && <DocumentsTab dealId={deal.id} />}
        </>
      )}

      {/* Always show messages on fallen-through so they can reach their agent */}
      {isFallenThrough && (
        <MessagesTab dealId={deal.id} />
      )}

      {/* Lender card */}
      <div className="pt-14">
        <LenderCard deal={deal} />
      </div>

      {/* Agent's preferred vendor directory */}
      <VendorDirectory agentId={deal.agentId} />

      {/* Agent card */}
      <AgentCard agentName={deal.agentName} agentEmail={deal.agentEmail} agentPhone={deal.agentPhone} />
    </div>
  );
}
