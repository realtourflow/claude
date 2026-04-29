import { useState } from 'react';
import { Deal } from '../data/mockDeals';
import { Zap, DollarSign } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

type NodeState = 'done' | 'active' | 'pending';

type TrackNode = {
  id: string;
  label: string;
  state: NodeState;
};

type Track = {
  id: string;
  label: string;
  color: string;         // Tailwind bg color
  lineColor: string;     // SVG stroke
  textColor: string;     // label text
  nodes: TrackNode[];
};

// ─── Mock state derivation from deal ────────────────────────────────────────
// In production this would come from deal data. For now we simulate based on
// deal.ariveStatus and deal.stage.

function buildTracks(deal: Deal, loanMode: 'loan' | 'cash', showFastPass: boolean): Track[] {
  const a = deal.loanMilestones;

  // ── DEAL track (always shown) ─────────────────────────────────────────────
  const dealNodes: TrackNode[] = [
    { id: 'contract',    label: 'Contract',       state: 'done' },
    { id: 'inspection',  label: 'Inspection',     state: 'done' },
    { id: 'appraisal',   label: 'Appraisal',      state: a?.appraisal === 'complete' ? 'done' : a?.appraisal === 'scheduled' ? 'active' : 'pending' },
    { id: 'finalize_ins', label: 'Finalize Ins.',  state: 'pending' },
    { id: 'prep_funds',  label: 'Prep Funds',     state: 'pending' },
    { id: 'final_walk',  label: 'Final Walk',     state: 'pending' },
    { id: 'closing',     label: 'Closing',        state: 'pending' },
  ];

  // ── LOAN track (hidden in cash mode) ─────────────────────────────────────
  const loanNodes: TrackNode[] = [
    { id: 'loan_setup',    label: 'Loan Setup',      state: a?.loanSetup ? 'done' : 'active' },
    { id: 'disclosures',   label: 'Disclosures',     state: a?.disclosuresSigned ? 'done' : a?.disclosuresSent ? 'active' : 'pending' },
    { id: 'underwriting',  label: 'Underwriting',    state: a?.underwriting === 'approved' ? 'done' : a?.underwriting === 'in_progress' ? 'active' : 'pending' },
    { id: 'closing_discl', label: 'Closing Discl.',  state: 'pending' },
    { id: 'ctc',           label: 'Clear to Close',  state: a?.clearToClose ? 'done' : 'pending' },
  ];

  // ── TITLE track ───────────────────────────────────────────────────────────
  const titleNodes: TrackNode[] = [
    { id: 'title_order',      label: 'Order',          state: 'done' },
    { id: 'title_search',     label: 'Search/HOA',     state: 'active' },
    { id: 'title_commitment', label: 'Commitment',     state: 'pending' },
    { id: 'wire_instr',       label: 'Wire Instr.',    state: 'pending' },
  ];

  // ── REPAIRS track ─────────────────────────────────────────────────────────
  const repairNodes: TrackNode[] = [
    { id: 'rep_inspection', label: 'Inspection',    state: 'done' },
    { id: 'rep_request',    label: 'Request',       state: 'active' },
    { id: 'rep_agreed',     label: 'Agreed',        state: 'pending' },
    { id: 'rep_in_progress', label: 'In Progress',  state: 'pending' },
    { id: 'rep_verified',   label: 'Verified',      state: 'pending' },
  ];

  // ── FAST PASS track ───────────────────────────────────────────────────────
  const fastPassNodes: TrackNode[] = [
    { id: 'fp_intake',      label: 'Intake',        state: 'done' },
    { id: 'fp_utilities',   label: 'Utilities',     state: 'active' },
    { id: 'fp_cleaning',    label: 'Cleaning',      state: 'pending' },
    { id: 'fp_movers',      label: 'Movers',        state: 'pending' },
    { id: 'fp_confirm',     label: 'Confirm',       state: 'pending' },
    { id: 'fp_welcome',     label: 'Welcome Home',  state: 'pending' },
  ];

  const tracks: Track[] = [
    {
      id: 'deal',
      label: 'Deal',
      color: 'bg-slate-500',
      lineColor: '#64748b',
      textColor: 'text-slate-700',
      nodes: dealNodes,
    },
  ];

  if (loanMode === 'loan') {
    tracks.push({
      id: 'loan',
      label: 'Loan',
      color: 'bg-blue-500',
      lineColor: '#3b82f6',
      textColor: 'text-blue-700',
      nodes: loanNodes,
    });
  }

  tracks.push({
    id: 'title',
    label: 'Title',
    color: 'bg-purple-500',
    lineColor: '#8b5cf6',
    textColor: 'text-purple-700',
    nodes: titleNodes,
  });

  if (deal.flags.includes('repair_request')) {
    tracks.push({
      id: 'repairs',
      label: 'Repairs',
      color: 'bg-orange-500',
      lineColor: '#f97316',
      textColor: 'text-orange-700',
      nodes: repairNodes,
    });
  }

  if (showFastPass && deal.flags.includes('fast_pass')) {
    tracks.push({
      id: 'fastpass',
      label: 'Fast Pass',
      color: 'bg-green-500',
      lineColor: '#22c55e',
      textColor: 'text-green-700',
      nodes: fastPassNodes,
    });
  }

  return tracks;
}

// ─── Node component ──────────────────────────────────────────────────────────

function TrackNode({ node, color }: { node: TrackNode; color: string }) {
  const base = 'flex-shrink-0 flex flex-col items-center gap-1.5 min-w-[56px] max-w-[72px]';

  return (
    <div className={base} title={node.label}>
      {/* Circle */}
      <div className="relative flex items-center justify-center">
        {node.state === 'active' && (
          <span className={`absolute inline-flex h-5 w-5 rounded-full opacity-40 animate-ping ${color}`} />
        )}
        <div className={[
          'h-4 w-4 rounded-full border-2 z-10',
          node.state === 'done'
            ? `${color} border-transparent`
            : node.state === 'active'
            ? `${color} border-white shadow-sm`
            : 'bg-white border-gray-300',
        ].join(' ')} />
      </div>
      {/* Label */}
      <span className={`text-center leading-tight text-[10px] font-medium ${
        node.state === 'pending' ? 'text-gray-400' : 'text-gray-700'
      }`}>
        {node.label}
      </span>
    </div>
  );
}

// ─── Track row ────────────────────────────────────────────────────────────────

function TrackRow({ track }: { track: Track }) {
  return (
    <div className="flex items-start gap-3">
      {/* Track label */}
      <div className="w-14 flex-shrink-0 flex flex-col items-end pt-1">
        <span className={`text-[10px] font-bold uppercase tracking-wide ${track.textColor}`}>
          {track.label}
        </span>
        <div className={`mt-1 h-0.5 w-8 rounded-full opacity-40 ${track.color}`} />
      </div>

      {/* Nodes with connecting line */}
      <div className="flex-1 relative">
        {/* Horizontal connector line */}
        <div
          className="absolute top-2 left-2 right-2 h-0.5 rounded-full"
          style={{ backgroundColor: track.lineColor, opacity: 0.25 }}
        />
        {/* Node row */}
        <div className="relative flex items-start gap-1 overflow-x-auto pb-1">
          {track.nodes.map((node) => (
            <TrackNode key={node.id} node={node} color={track.color} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main MetroMap ────────────────────────────────────────────────────────────

export default function MetroMap({ deal }: { deal: Deal }) {
  const [loanMode, setLoanMode] = useState<'loan' | 'cash'>(
    // Default to loan mode if any lender is assigned; cash only if no lender on file
    deal.vendors?.lender ? 'loan' : 'cash'
  );
  const [showFastPass, setShowFastPass] = useState(deal.flags.includes('fast_pass'));

  const tracks = buildTracks(deal, loanMode, showFastPass);

  return (
    <div className="rounded-xl bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b bg-brand-bg flex-wrap">
        <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Transaction Metro Map</span>
        <div className="flex items-center gap-2">
          {/* Loan / Cash toggle */}
          <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden text-xs">
            <button
              onClick={() => setLoanMode('loan')}
              className={`flex items-center gap-1 px-2.5 py-1.5 font-semibold transition-colors ${
                loanMode === 'loan' ? 'bg-blue-500 text-white' : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              <DollarSign size={11} /> Loan
            </button>
            <button
              onClick={() => setLoanMode('cash')}
              className={`flex items-center gap-1 px-2.5 py-1.5 font-semibold transition-colors ${
                loanMode === 'cash' ? 'bg-blue-500 text-white' : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              Cash
            </button>
          </div>

          {/* Fast Pass toggle — only if deal has fast_pass flag */}
          {deal.flags.includes('fast_pass') && (
            <button
              onClick={() => setShowFastPass((v) => !v)}
              className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                showFastPass
                  ? 'border-green-300 bg-green-500 text-white'
                  : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              <Zap size={11} /> Fast Pass
            </button>
          )}
        </div>
      </div>

      {/* Tracks */}
      <div className="p-4 space-y-5">
        {tracks.map((track) => (
          <TrackRow key={track.id} track={track} />
        ))}
      </div>

      {/* Legend */}
      <div className="border-t px-4 py-2.5 bg-brand-bg/50 flex items-center gap-4 flex-wrap">
        {[
          { label: 'Done', dotClass: 'bg-gray-500' },
          { label: 'Active', dotClass: 'bg-gray-500 animate-pulse' },
          { label: 'Pending', dotClass: 'bg-white border-2 border-gray-300' },
        ].map(({ label, dotClass }) => (
          <span key={label} className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${dotClass}`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
