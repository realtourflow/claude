import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { AriveTracker, AriveKeyDates, Deal, DealStage, LoanMilestones, FastPassEnrollment, SmoothExitEnrollment } from '../data/mockDeals';

export type ApiDeal = {
  id: string;
  agent_id: string;
  type: 'buy' | 'sell';
  stage: string;
  health: 'green' | 'yellow' | 'red';
  title: string;
  address: string | null;
  price: number | null;
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

export function apiDealToFrontend(d: ApiDeal): Deal {
  const price = d.price ?? 0;

  let loanMilestones: LoanMilestones | undefined;
  if (d.arive_linked && d.arive_milestones && d.arive_milestones.length > 0) {
    loanMilestones = ariveMilestonesFromTrackers(
      d.arive_milestones,
      d.arive_loan_status,
      d.arive_key_dates,
    );
  }

  const closingDate = d.arive_key_dates?.estimatedFundingDate
    ?? d.arive_key_dates?.closingContingency
    ?? undefined;

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
    estimatedCommission: Math.round(price * 0.03),
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
  };
}

export function useDeal(id: string | undefined) {
  const [deal, setDeal] = useState<Deal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const raw = await api.get<ApiDeal>(`/deals/${id}`);
      setDeal(apiDealToFrontend(raw));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load deal');
      setDeal(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return { deal, loading, error, refresh: load };
}

export async function patchStage(dealId: string, stage: string): Promise<ApiDeal> {
  return api.patch<ApiDeal>(`/deals/${dealId}/stage`, { stage });
}

export function useDeals() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const raw = await api.get<ApiDeal[]>('/deals');
      setDeals(raw.map(apiDealToFrontend));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load deals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { deals, loading, error, refresh: load };
}
