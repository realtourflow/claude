/**
 * Shared client-side entity types (#88).
 *
 * The authoritative `Deal` / `Task` client types used to live in the
 * mock-data files (`lib/data/mockDeals.ts` / `lib/data/mockTasks.ts`).
 * They now live here; the mock files re-export them so the existing
 * `from "@/lib/data/mockDeals"` import sites keep compiling. Rewriting
 * those import sites to point here is ticket #89's follow-up.
 *
 * Wire (API) request/response contracts live in `lib/schemas/` as zod
 * schemas — this file is the client-side view model layer.
 */
import type { FastPassEnrollment } from "./data/mockFastPass";
import type { SmoothExitEnrollment } from "./data/mockSmoothExit";

export type { FastPassEnrollment, SmoothExitEnrollment };

export type DealStatus = 'active' | 'fallen_through';

export type DealStage =
  | 'intake'
  | 'active_search'
  | 'offer_active'
  | 'under_contract'
  | 'pre_close'
  | 'closing'
  | 'post_close';

export type DealType = 'buy' | 'sell';
export type DealHealth = 'green' | 'yellow' | 'red';
export type DealPriority = 'high' | 'medium' | 'low';

/**
 * Valid deal flags. Use these instead of raw strings.
 * Note: disclosure state is derived from loanMilestones (disclosuresSent + disclosuresSigned),
 * not from a flag, to keep a single source of truth.
 */
export type DealFlag =
  | 'fast_pass'       // buyer enrolled in Fast Pass concierge service
  | 'repair_request'  // buyer has submitted a repair request
  | 'mountain_mortgage' // buyer is using Mountain Mortgage (used for ARIVE default)
  | 'asap_timeline'   // seller/buyer has urgent timeline
  | 'also_buying';    // seller is also purchasing a new home

export type Vendor = {
  company: string;
  contactName?: string;
  phone?: string;
  email?: string;
};

export type LenderVendor = Vendor & {
  /** true = Mountain Mortgage → milestones auto-synced from ARIVE API */
  isAriveIntegrated: boolean;
  loanOfficer?: string;
  /** Direct link to lender's borrower portal — shown as a button in the buyer/seller view */
  portalUrl?: string;
};

export type DealVendors = {
  lender?: LenderVendor;
  titleCompany?: Vendor;
  closingAttorney?: Vendor;
  inspector?: Vendor;
  /** Homeowners insurance — required on every purchase to close */
  insurance?: Vendor;
};

export type AriveTracker = {
  name: string;
  currentTrackerStatus: { status: string };
};

export type AriveKeyDates = Record<string, string | null>;

export type LoanMilestones = {
  /** 'arive' = read-only, synced from Mountain Mortgage. 'manual' = editable by TC/agent. */
  source: 'arive' | 'manual';
  // Ordered milestones (manual or derived from ARIVE)
  loanSetup: boolean;
  disclosuresOut: boolean;
  disclosuresSignedSubmitted: boolean;
  approvedWithConditions: boolean;
  resubmittal: boolean;
  clearToClose: boolean;
  // Separate: appraisal API tracker
  appraisal: 'pending' | 'ordered' | 'scheduled' | 'complete' | null;
  // Funded = loan disbursed, triggers celebration
  funded: boolean;
  // ARIVE raw tracker data (present when source === 'arive')
  ariveTrackers?: AriveTracker[];
  ariveLoanStatus?: string;
  ariveKeyDates?: AriveKeyDates;
};

export type Deal = {
  id: string;
  type: DealType;
  clientName: string;
  clientId: string;
  agentId: string;
  stage: DealStage;
  health: DealHealth;
  priority: DealPriority;
  property: {
    address: string;
    city: string;
    state: string;
    zip: string;
    price: number;
    image?: string;
  };
  timeline: {
    createdAt: string;
    closingDate?: string;
    daysInStage: number;
    daysToClose?: number;
  };
  flags: DealFlag[];
  status: DealStatus;
  /** Reason deal fell through — only present when status === 'fallen_through' */
  fallReason?: string;
  /** Stage the deal was in when it fell through — for displaying history */
  fellFromStage?: DealStage;
  /** Loan milestone tracking. Present on buy deals (and sell deals with a buyer's lender). */
  loanMilestones?: LoanMilestones;
  /** Vendors assigned to this file — lender, title company, inspector. */
  vendors?: DealVendors;
  estimatedCommission: number;
  commissionPct?: number;
  notes?: string;
  fastPass?: FastPassEnrollment;
  smoothExit?: SmoothExitEnrollment;
  /** Populated from real API — agent contact info attached to each deal */
  agentName?: string;
  agentEmail?: string;
  agentPhone?: string | null;
  /** Task counts populated from real API */
  openTaskCount?: number;
  overdueTaskCount?: number;
  /** Closing fee — populated from real API */
  feeStatus?: 'unpaid' | 'pending' | 'paid' | 'waived';
  feeAmountCents?: number;
  feePaidAt?: string | null;
  /** Deal flags — populated from real API */
  preApproved?: boolean;
  baaSigned?: boolean;
  disclosuresComplete?: boolean;
  /**
   * Agent-set "Buyer's Progress" step shown on the seller portal (#184).
   * Persisted server-side (deals.buyer_status); one of BUYER_STATUS_STEPS
   * in lib/buyer-status.ts, or undefined when not set.
   */
  buyerStatus?: string;
};

export type Task = {
  id: string;
  dealId: string;
  title: string;
  description?: string;
  assignedTo: 'agent' | 'buyer' | 'seller' | 'tc' | 'admin' | 'third_party';
  assignedToId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'overdue' | 'blocked';
  priority: 'high' | 'medium' | 'low';
  source: 'ai' | 'manual';
  stageContext: DealStage;
  dueDate?: string;
  completedAt?: string;
  dependsOn?: string[];
  actionType?: 'confirm' | 'upload' | 'link';
  actionUrl?: string;
};
