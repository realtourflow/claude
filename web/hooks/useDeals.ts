"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { extractClosingDate } from "@/lib/arive-dates";
import { AriveTracker, AriveKeyDates, Deal, DealStage, LoanMilestones, FastPassEnrollment, SmoothExitEnrollment } from "@/lib/data/mockDeals";

export type ApiDeal = {
  id: string;
  agent_id: string;
  type: 'buy' | 'sell';
  stage: string;
  health: 'green' | 'yellow' | 'red';
  title: string;
  address: string | null;
  /** Postgres DECIMAL serialized as text by the API (`price::text`). */
  price: string | null;
  arive_linked: boolean;
  arive_loan_id?: string | null;
  arive_milestones?: AriveTracker[] | null;
  arive_key_dates?: AriveKeyDates | null;
  arive_loan_status?: string | null;
  notes?: string | null;
  fee_status?: string;
  fee_amount_cents?: number;
  fee_paid_at?: string | null;
  fast_pass?: FastPassApiData | null;
  smooth_exit?: SmoothExitApiData | null;
  pre_approved?: boolean;
  baa_signed?: boolean;
  disclosures_complete?: boolean;
  /** Agent-set "Buyer's Progress" step shown on the seller portal (#184). */
  buyer_status?: string | null;
  /** Postgres DECIMAL serialized as text by the API (`commission_pct::text`). */
  commission_pct?: string | null;
  created_at: string;
  updated_at: string;
  agent_name?: string;
  agent_email?: string;
  agent_phone?: string | null;
  open_task_count?: number;
  overdue_task_count?: number;
};

type FastPassApiData = {
  status: string;
  payment_option: string;
  selected_upsells?: string[];
  total_cents?: number;
  enrolled_at?: string;
};

type SmoothExitApiData = {
  status: string;
  payment_option: string;
  estimated_sale_price?: number;
  fee_cents?: number;
  enrolled_at?: string;
  selected_upsells?: string[];
  upsell_total_cents?: number;
  upsells_paid?: boolean;
};

function fastPassFromApi(d: FastPassApiData): FastPassEnrollment {
  return {
    enrolledAt: d.enrolled_at ?? new Date().toISOString(),
    status: (d.status as FastPassEnrollment['status']) ?? 'active',
    paymentOption: (d.payment_option as FastPassEnrollment['paymentOption']) ?? 'now',
    selectedUpsells: (d.selected_upsells ?? []) as FastPassEnrollment['selectedUpsells'],
    totalPaid: Math.round((d.total_cents ?? 0) / 100),
  };
}

function smoothExitFromApi(d: SmoothExitApiData): SmoothExitEnrollment {
  const salePrice = d.estimated_sale_price ?? 0;
  return {
    enrolledAt: d.enrolled_at ?? new Date().toISOString(),
    status: (d.status as SmoothExitEnrollment['status']) ?? 'active',
    paymentOption: (d.payment_option as SmoothExitEnrollment['paymentOption']) ?? 'from_proceeds',
    estimatedSalePrice: salePrice,
    fee: Math.round((d.fee_cents ?? salePrice * 0.01)),
    buyingNext: false,
    selectedUpsells: d.selected_upsells ?? [],
    upsellTotalCents: d.upsell_total_cents ?? 0,
    upsellsPaid: d.upsells_paid ?? false,
  };
}

function ariveMilestonesFromTrackers(
  trackers: AriveTracker[],
  loanStatus: string | null | undefined,
  keyDates: AriveKeyDates | null | undefined,
): LoanMilestones {
  const get = (name: string) =>
    trackers.find((t) => t.name === name)?.currentTrackerStatus?.status ?? '';

  const isComplete = (name: string) => get(name).toLowerCase() === 'completed';
  const isStarted = (name: string) => {
    const s = get(name).toLowerCase();
    return s !== '' && s !== 'not_started';
  };

  const appraisalStatus = get('APPRAISAL').toLowerCase();
  let appraisal: LoanMilestones['appraisal'] = null;
  if (isComplete('APPRAISAL')) appraisal = 'complete';
  else if (appraisalStatus === 'scheduled') appraisal = 'scheduled';
  else if (appraisalStatus === 'ordered' || isStarted('APPRAISAL')) appraisal = 'ordered';
  else if (appraisalStatus !== '') appraisal = 'pending';

  const status = loanStatus?.toLowerCase() ?? '';

  return {
    source: 'arive',
    loanSetup: true,
    disclosuresOut: isStarted('CD'),
    disclosuresSignedSubmitted: isComplete('CD'),
    approvedWithConditions: status.includes('approved') || status.includes('conditional'),
    resubmittal: status.includes('resubmit') || status.includes('suspended'),
    clearToClose: status.includes('clear') || isComplete('SIGNED_DOCS_WITH_LENDER'),
    appraisal,
    funded: isComplete('FUNDING_WIRE'),
    ariveTrackers: trackers,
    ariveLoanStatus: loanStatus ?? undefined,
    ariveKeyDates: keyDates ?? undefined,
  };
}

/**
 * Numeric deal columns (DECIMAL) arrive over the wire as text. Parse
 * null-safely: null, empty string, and garbage stay null — callers apply
 * the client-type default at the assignment site.
 */
function parseNumeric(v: string | null | undefined): number | null {
  if (v == null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function apiDealToFrontend(d: ApiDeal): Deal {
  // Deal.property.price is a plain number; 0 is the client's TBD sentinel.
  const price = parseNumeric(d.price) ?? 0;
  const commissionPct = parseNumeric(d.commission_pct) ?? 3;

  let loanMilestones: LoanMilestones | undefined;
  if (d.arive_linked && d.arive_milestones && d.arive_milestones.length > 0) {
    loanMilestones = ariveMilestonesFromTrackers(
      d.arive_milestones,
      d.arive_loan_status,
      d.arive_key_dates,
    );
  }

  // Same key selection as the calendar push (lib/jobs.ts) and the iCal feed —
  // see lib/arive-dates.ts (#196).
  const closingDate = extractClosingDate(d.arive_key_dates) ?? undefined;

  return {
    id: d.id,
    type: d.type,
    clientName: d.title,
    clientId: '',
    agentId: d.agent_id,
    stage: d.stage as DealStage,
    health: d.health ?? 'green',
    priority: 'medium',
    property: {
      address: d.address ?? 'TBD',
      city: '',
      state: '',
      zip: '',
      price,
    },
    timeline: {
      createdAt: d.created_at,
      closingDate: closingDate ?? undefined,
      daysInStage: Math.max(
        0,
        Math.floor((Date.now() - new Date(d.updated_at).getTime()) / 86_400_000),
      ),
    },
    flags: d.arive_linked ? ['mountain_mortgage'] : [],
    status: 'active',
    estimatedCommission: Math.round(price * (commissionPct / 100)),
    commissionPct,
    agentName: d.agent_name,
    agentEmail: d.agent_email,
    agentPhone: d.agent_phone,
    notes: d.notes ?? undefined,
    loanMilestones,
    openTaskCount: d.open_task_count ?? 0,
    overdueTaskCount: d.overdue_task_count ?? 0,
    feeStatus: (d.fee_status as Deal['feeStatus']) ?? 'unpaid',
    feeAmountCents: d.fee_amount_cents ?? 7500,
    feePaidAt: d.fee_paid_at ?? null,
    fastPass: d.fast_pass ? fastPassFromApi(d.fast_pass) : undefined,
    smoothExit: d.smooth_exit ? smoothExitFromApi(d.smooth_exit) : undefined,
    preApproved: d.pre_approved ?? false,
    baaSigned: d.baa_signed ?? false,
    disclosuresComplete: d.disclosures_complete ?? false,
    buyerStatus: d.buyer_status ?? undefined,
  };
}

export function useDeal(id: string | undefined): {
  deal: Deal | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const query = useQuery({
    queryKey: ['deal', id],
    queryFn: async () => {
      const raw = await api.get<ApiDeal>(`/deals/${id}`);
      return apiDealToFrontend(raw);
    },
    enabled: Boolean(id),
  });

  return {
    deal: query.data ?? null,
    loading: query.isLoading || query.isFetching,
    error: query.error instanceof Error ? query.error.message : null,
    refresh: () => { void query.refetch(); },
  };
}

export async function patchStage(dealId: string, stage: string, force?: boolean): Promise<ApiDeal> {
  const qs = force ? '?force=true' : '';
  return api.patch<ApiDeal>(`/deals/${dealId}/stage${qs}`, { stage });
}

export function useDeals(): {
  deals: Deal[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const query = useQuery({
    queryKey: ['deals'],
    queryFn: async () => {
      const raw = await api.get<ApiDeal[]>('/deals');
      return raw.map(apiDealToFrontend);
    },
  });

  return {
    deals: query.data ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refresh: () => { void query.refetch(); },
  };
}
