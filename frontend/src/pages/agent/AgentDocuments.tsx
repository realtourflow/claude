import { Link } from 'react-router-dom';
import { useDeals } from '../../hooks/useDeals';
import { FileText, ArrowRight, MapPin } from 'lucide-react';

const STAGE_LABELS: Record<string, string> = {
  intake: 'Intake',
  active_search: 'Active Search',
  offer_active: 'Offer Active',
  under_contract: 'Under Contract',
  pre_close: 'Pre-Close',
  closing: 'Closing',
  post_close: 'Post-Close',
};

export default function AgentDocuments() {
  const { deals, loading, error } = useDeals();

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-navy text-white">
          <FileText size={18} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-brand-navy">Documents</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Files are organized by deal. Open a deal to upload contracts, disclosures, and other documents.
          </p>
        </div>
      </div>

      <div className="rounded-xl bg-brand-navy/5 border border-brand-navy/10 p-4 text-xs text-brand-navy/80">
        Tip: To set up reusable templates (BAA, listing agreement, purchase contract, disclosure) go to{' '}
        <Link to="/agent/settings" className="font-semibold underline">Settings → Documents</Link>.
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 p-5 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl bg-white p-10 text-center shadow-sm text-sm text-gray-400">
          Loading…
        </div>
      ) : deals.length === 0 ? (
        <div className="rounded-xl bg-white p-10 text-center shadow-sm">
          <p className="text-sm text-gray-500">You don't have any deals yet.</p>
          <Link
            to="/agent/pipeline"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90 transition-colors"
          >
            Create a deal
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {deals.map((deal) => (
            <Link
              key={deal.id}
              to={`/agent/deals/${deal.id}?tab=documents`}
              className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-sm hover:shadow-md transition-shadow group"
            >
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-brand-navy/5 text-brand-navy">
                <FileText size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-brand-navy text-sm truncate">{deal.clientName}</span>
                  <span className="rounded-full bg-brand-navy/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-navy">
                    {STAGE_LABELS[deal.stage] ?? deal.stage}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-400 truncate">
                  <MapPin size={10} />
                  {[deal.property.address, deal.property.city].filter(Boolean).join(', ') || 'TBD'}
                </div>
              </div>
              <ArrowRight size={14} className="flex-shrink-0 text-gray-300 group-hover:text-brand-gold transition-colors" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
