import { useParams, Link } from 'react-router-dom';
import { useDeals } from '../../hooks/useDeals';
import { useUsers, AppUser } from '../../hooks/useUsers';
import { Deal } from '../../data/mockDeals';
import {
  AlertTriangle,
  TrendingUp,
  DollarSign,
  Zap,
  FileWarning,
  CalendarClock,
  CheckSquare,
  Users,
  Check,
  Mail,
  ShieldCheck,
  UserX,
} from 'lucide-react';
import { FAST_PASS_UPSELLS } from '../../data/mockFastPass';
import { NEXT_STEP_LABELS, nextStepQualifiesForBridge } from '../../data/mockSmoothExit';

// ─── Shared helpers ────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  intake: 'Intake',
  active_search: 'Active Search',
  offer_active: 'Offer Active',
  under_contract: 'Under Contract',
  pre_close: 'Pre-Close',
  closing: 'Closing',
  post_close: 'Post-Close',
};

const STAGE_ORDER = [
  'intake',
  'active_search',
  'offer_active',
  'under_contract',
  'pre_close',
  'closing',
  'post_close',
];

const HEALTH_DOT: Record<string, string> = {
  green: 'bg-green-400',
  yellow: 'bg-amber-400',
  red: 'bg-red-500',
};

const HEALTH_BORDER: Record<string, string> = {
  green: 'border-l-green-400',
  yellow: 'border-l-amber-400',
  red: 'border-l-red-500',
};

const HEALTH_BADGE: Record<string, string> = {
  green: 'bg-green-100 text-green-700',
  yellow: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
};

function fmt$(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

// ─── Stat Card ─────────────────────────────────────────────────────────────────

type StatProps = {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent?: string;
};

function StatCard({ label, value, icon, accent = 'text-brand-navy' }: StatProps) {
  return (
    <div className="flex items-center gap-4 rounded-xl bg-white px-5 py-4 shadow-sm">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-brand-navy/5 text-brand-navy">
        {icon}
      </div>
      <div>
        <div className={`text-xl font-bold ${accent}`}>{value}</div>
        <div className="text-xs text-gray-400 font-medium">{label}</div>
      </div>
    </div>
  );
}

// ─── Deal Row (compact) ────────────────────────────────────────────────────────

function DealRow({ deal }: { deal: Deal }) {
  const overdueTasks = deal.overdueTaskCount ?? 0;
  const openTasks = deal.openTaskCount ?? 0;

  return (
    <div className={`flex items-center gap-4 border-l-4 ${HEALTH_BORDER[deal.health]} bg-white px-5 py-3 rounded-r-xl shadow-sm`}>
      <div className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${HEALTH_DOT[deal.health]}`} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-brand-navy text-sm">{deal.clientName}</span>
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${deal.type === 'buy' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
            {deal.type}
          </span>
          {overdueTasks > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
              <AlertTriangle size={9} />
              {overdueTasks} overdue
            </span>
          )}
          {deal.flags.includes('fast_pass') && (
            <span className="flex items-center gap-1 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-bold text-green-700">
              <Zap size={9} />
              FastPass
            </span>
          )}
        </div>
        <div className="text-xs text-gray-400 truncate">
          {deal.property.address}, {deal.property.city}
        </div>
      </div>

      <div className="hidden sm:block text-xs text-gray-500 w-28 text-center">
        {STAGE_LABELS[deal.stage]}
      </div>

      <div className="text-sm font-semibold text-brand-navy w-20 text-right">
        {fmt$(deal.property.price)}
      </div>

      {deal.agentName && (
        <Link
          to="/admin/users"
          title={`View ${deal.agentName}'s profile`}
          className="flex items-center gap-1.5 group"
        >
          <div className="h-6 w-6 rounded-full bg-brand-navy/10 flex items-center justify-center text-[10px] font-bold text-brand-navy ring-2 ring-transparent group-hover:ring-brand-navy/30 transition-all">
            {initials(deal.agentName)}
          </div>
          <span className="hidden lg:block text-xs text-gray-500 group-hover:text-brand-navy transition-colors">
            {deal.agentName.split(' ')[0]}
          </span>
        </Link>
      )}

      <div className="text-xs text-gray-400 w-12 text-right">{openTasks} tasks</div>
    </div>
  );
}

// ─── Pipeline Overview ─────────────────────────────────────────────────────────

function PipelineOverview({ deals }: { deals: Deal[] }) {
  const activeDeals = deals.filter((d) => d.stage !== 'post_close');
  const totalPipeline = activeDeals.reduce((s, d) => s + d.property.price, 0);
  const totalCommission = activeDeals.reduce((s, d) => s + d.estimatedCommission, 0);
  const overdueTaskCount = activeDeals.reduce((s, d) => s + (d.overdueTaskCount ?? 0), 0);
  const pendingDisclosures = activeDeals.filter(
    (d) => d.loanMilestones?.disclosuresOut && !d.loanMilestones?.disclosuresSignedSubmitted,
  );
  const fastPassDeals = activeDeals.filter((d) => d.flags.includes('fast_pass'));
  const redDeals = activeDeals.filter((d) => d.health === 'red');
  const closingSoon = activeDeals.filter((d) => {
    if (!d.timeline.closingDate) return false;
    const days = Math.ceil((new Date(d.timeline.closingDate).getTime() - Date.now()) / 86_400_000);
    return days >= 0 && days <= 30;
  });

  const byStage = STAGE_ORDER.map((stage) => ({
    stage,
    deals: activeDeals.filter((d) => d.stage === stage),
  })).filter((g) => g.deals.length > 0);

  // Derive agents from deals — no MOCK_USERS needed
  const agentMap = new Map<string, { name: string; email: string; deals: Deal[] }>();
  activeDeals.forEach((d) => {
    if (!d.agentId) return;
    if (!agentMap.has(d.agentId)) {
      agentMap.set(d.agentId, { name: d.agentName ?? 'Unknown', email: d.agentEmail ?? '', deals: [] });
    }
    agentMap.get(d.agentId)!.deals.push(d);
  });
  const agentEntries = Array.from(agentMap.entries());

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Pipeline Overview</h1>
        <p className="text-sm text-gray-400 mt-0.5">System-wide view across all agents and deals</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        <StatCard label="Total Pipeline Value" value={fmt$(totalPipeline)} icon={<TrendingUp size={18} />} />
        <StatCard label="Active Deals" value={activeDeals.length} icon={<CheckSquare size={18} />} />
        <StatCard label="Est. Commission" value={fmt$(totalCommission)} icon={<DollarSign size={18} />} accent="text-green-600" />
        <StatCard
          label="Overdue Tasks"
          value={overdueTaskCount}
          icon={<AlertTriangle size={18} />}
          accent={overdueTaskCount > 0 ? 'text-red-600' : 'text-brand-navy'}
        />
        <StatCard
          label="Pending Disclosures"
          value={pendingDisclosures.length}
          icon={<FileWarning size={18} />}
          accent={pendingDisclosures.length > 0 ? 'text-amber-600' : 'text-brand-navy'}
        />
        <StatCard
          label="Closing ≤ 30 Days"
          value={closingSoon.length}
          icon={<CalendarClock size={18} />}
          accent={closingSoon.length > 0 ? 'text-brand-navy' : 'text-gray-400'}
        />
        <StatCard label="Active Fast Pass" value={fastPassDeals.length} icon={<Zap size={18} />} accent="text-green-600" />
        <StatCard label="Agents" value={agentEntries.length} icon={<Users size={18} />} />
      </div>

      {(redDeals.length > 0 || overdueTaskCount > 0) && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle size={15} className="text-red-500" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-red-600">Needs Attention</h2>
          </div>
          <div className="space-y-2">
            {redDeals.map((d) => <DealRow key={d.id} deal={d} />)}
            {deals.filter(
              (d) => d.health !== 'red' && d.stage !== 'post_close' && (d.overdueTaskCount ?? 0) > 0,
            ).map((d) => <DealRow key={d.id} deal={d} />)}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-gray-400">Deals by Stage</h2>
        <div className="space-y-5">
          {byStage.map(({ stage, deals: stageDeals }) => (
            <div key={stage}>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {STAGE_LABELS[stage]}
                </span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500">
                  {stageDeals.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {stageDeals.map((d) => <DealRow key={d.id} deal={d} />)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-gray-400">By Agent</h2>
        <div className="space-y-2">
          {agentEntries.map(([agentId, { name, email, deals: agentDeals }]) => {
            const agentCommission = agentDeals.reduce((s, d) => s + d.estimatedCommission, 0);
            const agentOverdue = agentDeals.reduce((s, d) => s + (d.overdueTaskCount ?? 0), 0);
            const healthCounts = {
              green: agentDeals.filter((d) => d.health === 'green').length,
              yellow: agentDeals.filter((d) => d.health === 'yellow').length,
              red: agentDeals.filter((d) => d.health === 'red').length,
            };
            return (
              <Link
                key={agentId}
                to="/admin/users"
                className="flex items-center gap-4 rounded-xl bg-white px-5 py-4 shadow-sm hover:shadow-md transition-shadow group"
              >
                <div className="h-10 w-10 rounded-full bg-brand-navy/10 flex items-center justify-center text-sm font-bold text-brand-navy ring-2 ring-brand-navy/10 group-hover:ring-brand-navy/30 transition-all flex-shrink-0">
                  {initials(name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-brand-navy text-sm">{name}</div>
                  <div className="text-xs text-gray-400">{email}</div>
                </div>
                <div className="flex items-center gap-2.5">
                  {healthCounts.green > 0 && (
                    <span className="flex items-center gap-1 text-xs font-medium text-green-600">
                      <span className="h-2 w-2 rounded-full bg-green-400 inline-block" />
                      {healthCounts.green}
                    </span>
                  )}
                  {healthCounts.yellow > 0 && (
                    <span className="flex items-center gap-1 text-xs font-medium text-amber-600">
                      <span className="h-2 w-2 rounded-full bg-amber-400 inline-block" />
                      {healthCounts.yellow}
                    </span>
                  )}
                  {healthCounts.red > 0 && (
                    <span className="flex items-center gap-1 text-xs font-medium text-red-600">
                      <span className="h-2 w-2 rounded-full bg-red-500 inline-block" />
                      {healthCounts.red}
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-brand-navy">{fmt$(agentCommission)}</div>
                  <div className="text-xs text-gray-400">{agentDeals.length} active deals</div>
                </div>
                {agentOverdue > 0 && (
                  <div className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600">
                    <AlertTriangle size={11} />
                    {agentOverdue} overdue
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ─── All Deals ─────────────────────────────────────────────────────────────────

function AllDeals({ deals }: { deals: Deal[] }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">All Deals</h1>
        <p className="text-sm text-gray-400 mt-0.5">{deals.length} deals total</p>
      </div>
      <div className="rounded-xl bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-400">
              <th className="px-5 py-3">Client</th>
              <th className="px-5 py-3">Property</th>
              <th className="px-5 py-3">Type</th>
              <th className="px-5 py-3">Stage</th>
              <th className="px-5 py-3">Health</th>
              <th className="px-5 py-3">Agent</th>
              <th className="px-5 py-3">Closing</th>
              <th className="px-5 py-3 text-right">Commission</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((deal) => (
              <tr key={deal.id} className="border-b last:border-0 hover:bg-gray-50/50 transition-colors">
                <td className="px-5 py-3 font-medium text-brand-navy">{deal.clientName}</td>
                <td className="px-5 py-3 text-gray-600">
                  {deal.property.address}
                  {deal.property.city && <span className="ml-1 text-gray-400 text-xs">{deal.property.city}</span>}
                </td>
                <td className="px-5 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium uppercase ${deal.type === 'buy' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                    {deal.type}
                  </span>
                </td>
                <td className="px-5 py-3 text-gray-600">{STAGE_LABELS[deal.stage]}</td>
                <td className="px-5 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${HEALTH_BADGE[deal.health]}`}>
                    {deal.health}
                  </span>
                </td>
                <td className="px-5 py-3">
                  {deal.agentName && (
                    <Link to="/admin/users" className="flex items-center gap-1.5 group w-fit">
                      <div className="h-5 w-5 rounded-full bg-brand-navy/10 flex items-center justify-center text-[9px] font-bold text-brand-navy ring-2 ring-transparent group-hover:ring-brand-navy/30 transition-all">
                        {initials(deal.agentName)}
                      </div>
                      <span className="text-gray-600 text-xs group-hover:text-brand-navy transition-colors">
                        {deal.agentName}
                      </span>
                    </Link>
                  )}
                </td>
                <td className="px-5 py-3 text-gray-500 text-xs">
                  {deal.timeline.closingDate ?? '—'}
                </td>
                <td className="px-5 py-3 text-right font-medium text-brand-navy">
                  ${deal.estimatedCommission.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Pending Disclosures ───────────────────────────────────────────────────────

function PendingDisclosures({ deals }: { deals: Deal[] }) {
  const pending = deals.filter(
    (d) => d.loanMilestones?.disclosuresOut && !d.loanMilestones?.disclosuresSignedSubmitted,
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Pending Disclosures</h1>
        <p className="text-sm text-gray-400 mt-0.5">Disclosures sent but not yet signed</p>
      </div>
      {pending.length === 0 ? (
        <div className="rounded-xl bg-white px-5 py-10 text-center text-gray-400 shadow-sm">
          No pending disclosures
        </div>
      ) : (
        <div className="space-y-2">
          {pending.map((d) => (
            <div key={d.id} className="flex items-center gap-4 rounded-xl bg-white px-5 py-4 shadow-sm border-l-4 border-l-amber-400">
              <FileWarning size={18} className="text-amber-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-brand-navy text-sm">{d.clientName}</div>
                <div className="text-xs text-gray-400">{d.property.address}, {d.property.city}</div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${HEALTH_BADGE[d.health]}`}>
                {d.health}
              </span>
              <span className="text-xs text-gray-400">{STAGE_LABELS[d.stage]}</span>
              <button className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 transition-colors">
                Send Reminder
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Pre-Approval Queue ────────────────────────────────────────────────────────

function PreApprovalQueue({ deals }: { deals: Deal[] }) {
  const mmDeals = deals.filter((d) => d.flags.includes('mountain_mortgage'));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Pre-Approval Queue</h1>
        <p className="text-sm text-gray-400 mt-0.5">Buyers in the Mountain Mortgage pre-approval pipeline</p>
      </div>
      {mmDeals.length === 0 ? (
        <div className="rounded-xl bg-white px-5 py-10 text-center text-gray-400 shadow-sm">
          No buyers in pre-approval queue
        </div>
      ) : (
        <div className="space-y-2">
          {mmDeals.map((d) => (
            <div key={d.id} className="flex items-center gap-4 rounded-xl bg-white px-5 py-4 shadow-sm border-l-4 border-l-blue-400">
              <CheckSquare size={18} className="text-blue-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-brand-navy text-sm">{d.clientName}</div>
                <div className="text-xs text-gray-400 truncate">
                  {(d.openTaskCount ?? 0) > 0 ? `${d.openTaskCount} open task${d.openTaskCount !== 1 ? 's' : ''}` : 'No open tasks'}
                </div>
              </div>
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                {STAGE_LABELS[d.stage]}
              </span>
              <div className="text-right">
                <div className="text-sm font-bold text-brand-navy">{fmt$(d.property.price)}</div>
                <div className="text-xs text-gray-400">target price</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Stuck Deals ──────────────────────────────────────────────────────────────

function StuckDeals({ deals }: { deals: Deal[] }) {
  const stuck = deals.filter(
    (d) => d.stage !== 'post_close' && d.timeline.daysInStage >= 14,
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Stuck Deals</h1>
        <p className="text-sm text-gray-400 mt-0.5">Deals that haven't progressed in 14+ days</p>
      </div>
      {stuck.length === 0 ? (
        <div className="rounded-xl bg-white px-5 py-10 text-center text-gray-400 shadow-sm">
          No stuck deals
        </div>
      ) : (
        <div className="space-y-2">
          {stuck.map((d) => (
            <div key={d.id} className={`flex items-center gap-4 border-l-4 ${HEALTH_BORDER[d.health]} bg-white px-5 py-4 rounded-r-xl shadow-sm`}>
              <AlertTriangle size={18} className="text-amber-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-brand-navy text-sm">{d.clientName}</div>
                <div className="text-xs text-gray-400">{d.property.address}, {d.property.city}</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-amber-600">{d.timeline.daysInStage}</div>
                <div className="text-xs text-gray-400">days in stage</div>
              </div>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                {STAGE_LABELS[d.stage]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Fees Collected ────────────────────────────────────────────────────────────

function FeesCollected({ deals }: { deals: Deal[] }) {
  const closedDeals = deals.filter((d) => d.stage === 'post_close');
  const totalCollected = closedDeals.reduce((s, d) => s + d.estimatedCommission, 0);
  const activeDeals = deals.filter((d) => d.stage !== 'post_close');
  const totalPending = activeDeals.reduce((s, d) => s + d.estimatedCommission, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Fees Collected</h1>
        <p className="text-sm text-gray-400 mt-0.5">Commission tracking across all deals</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl bg-white px-5 py-5 shadow-sm">
          <div className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Collected (Closed)</div>
          <div className="text-2xl font-bold text-green-600">{fmt$(totalCollected)}</div>
          <div className="text-xs text-gray-400 mt-1">{closedDeals.length} closed deals</div>
        </div>
        <div className="rounded-xl bg-white px-5 py-5 shadow-sm">
          <div className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Pipeline (Pending)</div>
          <div className="text-2xl font-bold text-brand-navy">{fmt$(totalPending)}</div>
          <div className="text-xs text-gray-400 mt-1">{activeDeals.length} active deals</div>
        </div>
      </div>

      <div className="rounded-xl bg-white shadow-sm overflow-hidden">
        <div className="border-b px-5 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">All Deals — Commission Breakdown</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-400">
              <th className="px-5 py-3">Client</th>
              <th className="px-5 py-3">Stage</th>
              <th className="px-5 py-3">Type</th>
              <th className="px-5 py-3 text-right">Property Value</th>
              <th className="px-5 py-3 text-right">Est. Commission</th>
              <th className="px-5 py-3 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((d) => (
              <tr key={d.id} className="border-b last:border-0 hover:bg-gray-50/50 transition-colors">
                <td className="px-5 py-3 font-medium text-brand-navy">{d.clientName}</td>
                <td className="px-5 py-3 text-gray-500 text-xs">{STAGE_LABELS[d.stage]}</td>
                <td className="px-5 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium uppercase ${d.type === 'buy' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                    {d.type}
                  </span>
                </td>
                <td className="px-5 py-3 text-right font-medium text-gray-700">
                  ${d.property.price.toLocaleString()}
                </td>
                <td className="px-5 py-3 text-right font-semibold text-brand-navy">
                  ${d.estimatedCommission.toLocaleString()}
                </td>
                <td className="px-5 py-3 text-right">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${d.stage === 'post_close' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {d.stage === 'post_close' ? 'Collected' : 'Pending'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Active Fast Pass ──────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { badge: string; border: string; label: string }> = {
  pending_payment: {
    badge: 'bg-amber-100 text-amber-700',
    border: 'border-l-amber-400',
    label: 'Pending Payment',
  },
  active: {
    badge: 'bg-green-100 text-green-700',
    border: 'border-l-green-400',
    label: 'Active',
  },
  complete: {
    badge: 'bg-gray-100 text-gray-500',
    border: 'border-l-gray-300',
    label: 'Complete',
  },
};

function ActiveFastPass({ deals }: { deals: Deal[] }) {
  const fpDeals = deals.filter((d) => d.flags.includes('fast_pass') && d.stage !== 'post_close');
  const pendingPayment = fpDeals.filter((d) => d.fastPass?.status === 'pending_payment');
  const active = fpDeals.filter((d) => d.fastPass?.status === 'active');
  const noEnrollment = fpDeals.filter((d) => !d.fastPass);

  function FPDealCard({ d }: { d: Deal }) {
    const fp = d.fastPass;
    const style = fp ? STATUS_STYLES[fp.status] : STATUS_STYLES.active;
    const upsellItems = fp
      ? FAST_PASS_UPSELLS.filter((u) => fp.selectedUpsells.includes(u.id))
      : [];

    return (
      <div className={`rounded-xl bg-white shadow-sm border-l-4 ${style.border} overflow-hidden`}>
        <div className="flex items-center gap-3 px-5 py-4">
          <Zap size={18} className="text-green-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-brand-navy text-sm">{d.clientName}</span>
              {fp && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${style.badge}`}>
                  {style.label}
                </span>
              )}
            </div>
            <div className="text-xs text-gray-400 truncate">
              {d.property.address}, {d.property.city}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            {fp && (
              <>
                <div className="text-sm font-black text-brand-navy">
                  ${fp.totalPaid.toLocaleString()}
                </div>
                <div className="text-xs text-gray-400">paid</div>
              </>
            )}
          </div>
          {fp?.status === 'pending_payment' && (
            <button className="ml-2 rounded-lg bg-green-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-600 transition-colors">
              Mark Paid
            </button>
          )}
        </div>

        {upsellItems.length > 0 && (
          <div className="border-t border-gray-50 px-5 py-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Add-ons
            </div>
            <div className="flex flex-wrap gap-1.5">
              {upsellItems.map((u) => (
                <span key={u.id} className="flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                  <Check size={9} strokeWidth={3} />
                  {u.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {fp?.surveyAnswers && (
          <div className="border-t border-gray-50 px-5 py-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-300">Move date</div>
              <div className="text-xs text-gray-600">
                {new Date(fp.surveyAnswers.targetMoveDate).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-300">Situation</div>
              <div className="text-xs text-gray-600 capitalize">{fp.surveyAnswers.currentSituation}</div>
            </div>
            {fp.surveyAnswers.utilities.length > 0 && (
              <div className="col-span-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-300">Utilities</div>
                <div className="text-xs text-gray-600">{fp.surveyAnswers.utilities.join(', ')}</div>
              </div>
            )}
            {fp.surveyAnswers.notes && (
              <div className="col-span-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-300">Notes</div>
                <div className="text-xs text-gray-600 italic">{fp.surveyAnswers.notes}</div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Active Fast Pass</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Deals enrolled in the Mountain Mortgage Fast Pass program
        </p>
      </div>

      {fpDeals.length === 0 ? (
        <div className="rounded-xl bg-white px-5 py-10 text-center text-gray-400 shadow-sm">
          No active Fast Pass deals
        </div>
      ) : (
        <>
          {pendingPayment.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-500" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-amber-600">
                  Awaiting Payment ({pendingPayment.length})
                </h2>
              </div>
              <div className="space-y-3">
                {pendingPayment.map((d) => <FPDealCard key={d.id} d={d} />)}
              </div>
            </section>
          )}

          {active.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">
                Active ({active.length})
              </h2>
              <div className="space-y-3">
                {active.map((d) => <FPDealCard key={d.id} d={d} />)}
              </div>
            </section>
          )}

          {noEnrollment.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">
                Flagged — No Enrollment Data
              </h2>
              <div className="space-y-3">
                {noEnrollment.map((d) => <FPDealCard key={d.id} d={d} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ─── Smooth Exit ──────────────────────────────────────────────────────────────

function SmoothExitQueue({ deals }: { deals: Deal[] }) {
  const seDeals = deals.filter((d) => d.smoothExit && d.stage !== 'post_close');
  const pending = seDeals.filter((d) => d.smoothExit?.status === 'pending');
  const active = seDeals.filter((d) => d.smoothExit?.status === 'active');

  function SECard({ d }: { d: Deal }) {
    const se = d.smoothExit!;
    const qualifies = se.nextStep ? nextStepQualifiesForBridge(se.nextStep) : false;

    return (
      <div className={`rounded-xl bg-white shadow-sm border-l-4 overflow-hidden ${se.status === 'pending' ? 'border-l-amber-400' : 'border-l-purple-400'}`}>
        <div className="flex items-center gap-3 px-5 py-4">
          <span className="text-xl flex-shrink-0">🚪</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-brand-navy text-sm">{d.clientName}</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${se.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'}`}>
                {se.status === 'pending' ? 'Pending' : 'Active'}
              </span>
              {qualifies && (
                <span className="rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] font-bold text-purple-600">
                  Buy Before Sell
                </span>
              )}
            </div>
            <div className="text-xs text-gray-400 truncate">
              {d.property.address}, {d.property.city}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-sm font-black text-brand-navy">${se.fee.toLocaleString()}</div>
            <div className="text-xs text-gray-400">1% fee</div>
          </div>
          {se.status === 'pending' && (
            <button className="ml-2 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 transition-colors">
              Activate
            </button>
          )}
        </div>
        {se.surveyAnswers && (
          <div className="border-t border-gray-50 px-5 py-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-300">What's next</div>
              <div className="text-xs text-gray-600">
                {se.nextStep ? NEXT_STEP_LABELS[se.nextStep] : '—'}
              </div>
            </div>
            {se.surveyAnswers.moveOutDate && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-300">Move-out</div>
                <div className="text-xs text-gray-600">
                  {new Date(se.surveyAnswers.moveOutDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              </div>
            )}
            {se.surveyAnswers.notes && (
              <div className="col-span-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-300">Notes</div>
                <div className="text-xs text-gray-600 italic">{se.surveyAnswers.notes}</div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Smooth Exit</h1>
        <p className="text-sm text-gray-400 mt-0.5">Seller concierge enrollments — move-out coordination and bridge financing</p>
      </div>

      {seDeals.length === 0 ? (
        <div className="rounded-xl bg-white px-5 py-10 text-center text-gray-400 shadow-sm">
          No active Smooth Exit enrollments
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-500" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-amber-600">Pending Activation ({pending.length})</h2>
              </div>
              <div className="space-y-3">{pending.map((d) => <SECard key={d.id} d={d} />)}</div>
            </section>
          )}
          {active.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">Active ({active.length})</h2>
              <div className="space-y-3">{active.map((d) => <SECard key={d.id} d={d} />)}</div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ─── ARIVE Status ──────────────────────────────────────────────────────────────

const ARIVE_CHECKS: { key: keyof NonNullable<Deal['loanMilestones']>; label: string }[] = [
  { key: 'loanSetup',                  label: 'Loan Setup' },
  { key: 'disclosuresOut',             label: 'Disclosures Out' },
  { key: 'disclosuresSignedSubmitted', label: 'Signed & Submitted' },
  { key: 'approvedWithConditions',     label: 'Approved w/ Conditions' },
  { key: 'resubmittal',                label: 'Resubmittal' },
  { key: 'clearToClose',               label: 'Clear to Close' },
];

function AriveStatus({ deals }: { deals: Deal[] }) {
  const dealsWithArive = deals.filter((d) => d.loanMilestones != null);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">ARIVE Status</h1>
        <p className="text-sm text-gray-400 mt-0.5">Loan milestone tracking across active deals</p>
      </div>
      {dealsWithArive.length === 0 ? (
        <div className="rounded-xl bg-white px-5 py-10 text-center text-gray-400 shadow-sm">
          No deals with ARIVE data
        </div>
      ) : (
        <div className="space-y-3">
          {dealsWithArive.map((d) => {
            const a = d.loanMilestones!;
            const checks = [a.loanSetup, a.disclosuresOut, a.disclosuresSignedSubmitted, a.approvedWithConditions, a.resubmittal, a.clearToClose];
            const done = checks.filter(Boolean).length;
            const pct = Math.round((done / checks.length) * 100);

            return (
              <div key={d.id} className="rounded-xl bg-white px-5 py-4 shadow-sm">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${HEALTH_DOT[d.health]}`} />
                  <div className="flex-1">
                    <span className="font-semibold text-brand-navy text-sm">{d.clientName}</span>
                    <span className="ml-2 text-xs text-gray-400">{d.property.address}</span>
                  </div>
                  <span className="text-xs text-gray-400">{STAGE_LABELS[d.stage]}</span>
                  <span className="text-xs font-semibold text-brand-navy">{pct}%</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {ARIVE_CHECKS.map(({ key, label }) => {
                    const val = a[key];
                    const checked = val === true;
                    return (
                      <div
                        key={key}
                        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${checked ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-400'}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${checked ? 'bg-green-400' : 'bg-gray-300'}`} />
                        {label}
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-3 mt-2">
                  <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${a.appraisal === 'complete' ? 'bg-green-50 text-green-700' : a.appraisal === 'scheduled' ? 'bg-amber-50 text-amber-600' : a.appraisal === 'ordered' ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-400'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${a.appraisal === 'complete' ? 'bg-green-400' : a.appraisal === 'scheduled' ? 'bg-amber-400' : a.appraisal === 'ordered' ? 'bg-blue-400' : 'bg-gray-300'}`} />
                    Appraisal: {a.appraisal ?? 'pending'}
                  </div>
                  {a.funded && (
                    <div className="flex items-center gap-1.5 rounded-lg bg-green-500 px-2.5 py-1.5 text-xs font-black text-white">
                      Funded ✓
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── User Management ──────────────────────────────────────────────────────────

const ROLE_STYLES: Record<string, { badge: string; label: string }> = {
  agent:           { badge: 'bg-blue-100 text-blue-700',    label: 'Agent' },
  tc:              { badge: 'bg-amber-100 text-amber-700',  label: 'TC' },
  buyer:           { badge: 'bg-green-100 text-green-700',  label: 'Buyer' },
  seller:          { badge: 'bg-purple-100 text-purple-700', label: 'Seller' },
  admin:           { badge: 'bg-red-100 text-red-700',      label: 'Admin' },
  lending_partner: { badge: 'bg-blue-100 text-blue-700',    label: 'Lending Partner' },
};

function UserManagement() {
  const { users, loading } = useUsers();

  const groups = [
    { id: 'agent',  label: 'Agents' },
    { id: 'tc',     label: 'Transaction Coordinators' },
    { id: 'buyer',  label: 'Buyers' },
    { id: 'seller', label: 'Sellers' },
  ] as const;

  const stats = groups.map((g) => ({
    ...g,
    count: users.filter((u) => u.role === g.id).length,
  }));

  function UserRow({ user }: { user: AppUser }) {
    const style = ROLE_STYLES[user.role] ?? ROLE_STYLES.agent;
    const userInitials = initials(user.name);

    return (
      <tr className="border-b last:border-0 hover:bg-gray-50/50 transition-colors">
        <td className="px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-brand-navy/10 flex items-center justify-center text-xs font-bold text-brand-navy flex-shrink-0">
              {userInitials}
            </div>
            <div>
              <div className="font-semibold text-brand-navy text-sm">{user.name}</div>
              <div className="text-xs text-gray-400">{user.id.slice(0, 8)}…</div>
            </div>
          </div>
        </td>
        <td className="px-5 py-3">
          <a href={`mailto:${user.email}`} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-navy transition-colors">
            <Mail size={11} /> {user.email}
          </a>
        </td>
        <td className="px-5 py-3">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.badge}`}>
            {style.label}
          </span>
        </td>
        <td className="px-5 py-3 text-center">
          <span className="text-xs text-gray-400">—</span>
        </td>
        <td className="px-5 py-3">
          <span className="flex items-center gap-1 text-xs font-medium text-green-600">
            <ShieldCheck size={13} /> Active
          </span>
        </td>
        <td className="px-5 py-3 text-right">
          <div className="flex items-center justify-end gap-2">
            <button className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              View Deals
            </button>
            <button className="flex items-center gap-1 rounded-lg border border-red-100 px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50 transition-colors">
              <UserX size={11} /> Deactivate
            </button>
          </div>
        </td>
      </tr>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-brand-navy">User Management</h1>
        <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Loading users…</div>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">User Management</h1>
        <p className="text-sm text-gray-400 mt-0.5">All platform users across every role</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(({ label, count, id }) => (
          <div key={id} className="rounded-xl bg-white px-5 py-4 shadow-sm">
            <div className={`text-2xl font-bold mb-0.5 ${
              id === 'agent' ? 'text-blue-600' :
              id === 'tc' ? 'text-amber-600' :
              id === 'buyer' ? 'text-green-600' : 'text-purple-600'
            }`}>{count}</div>
            <div className="text-xs text-gray-400 font-medium">{label}</div>
          </div>
        ))}
      </div>

      {groups.map(({ id, label }) => {
        const roleUsers = users.filter((u) => u.role === id);
        if (roleUsers.length === 0) return null;
        return (
          <section key={id}>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">{label}</h2>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500">{roleUsers.length}</span>
            </div>
            <div className="rounded-xl bg-white shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-400">
                    <th className="px-5 py-3">User</th>
                    <th className="px-5 py-3">Email</th>
                    <th className="px-5 py-3">Role</th>
                    <th className="px-5 py-3 text-center">Deals</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {roleUsers.map((u) => <UserRow key={u.id} user={u} />)}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <div className="rounded-xl border-2 border-dashed border-gray-200 px-5 py-6 text-center">
        <Users size={20} className="mx-auto mb-2 text-gray-300" />
        <p className="text-sm font-medium text-gray-500 mb-3">Need to add a new agent or TC?</p>
        <button className="rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy/80 transition-colors">
          Invite User
        </button>
      </div>
    </div>
  );
}

// ─── Coming Soon placeholder ───────────────────────────────────────────────────

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-brand-navy">{title}</h1>
      <div className="flex flex-col items-center justify-center rounded-xl bg-white py-16 shadow-sm text-center">
        <p className="text-gray-400 text-sm">Coming in a future phase</p>
      </div>
    </div>
  );
}

// ─── Main AdminDashboard ───────────────────────────────────────────────────────

export default function AdminDashboard() {
  const { section } = useParams<{ section?: string }>();
  const { deals, loading } = useDeals();

  if (section === 'users') return <UserManagement />;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-gray-400 text-sm">
        Loading…
      </div>
    );
  }

  switch (section) {
    case 'deals':       return <AllDeals deals={deals} />;
    case 'disclosures': return <PendingDisclosures deals={deals} />;
    case 'preapproval': return <PreApprovalQueue deals={deals} />;
    case 'stuck':       return <StuckDeals deals={deals} />;
    case 'fees':        return <FeesCollected deals={deals} />;
    case 'outstanding': return <ComingSoon title="Outstanding Items" />;
    case 'fastpass':    return <ActiveFastPass deals={deals} />;
    case 'smoothexit':  return <SmoothExitQueue deals={deals} />;
    case 'arive':       return <AriveStatus deals={deals} />;
    case 'metro':       return <ComingSoon title="Metro View" />;
    case 'promotions':  return <ComingSoon title="Promotions" />;
    case 'config':      return <ComingSoon title="System Config" />;
    default:            return <PipelineOverview deals={deals} />;
  }
}
