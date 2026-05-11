import { FastPassEnrollment } from './mockFastPass';
import { SmoothExitEnrollment } from './mockSmoothExit';
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
};

export const MOCK_DEALS: Deal[] = [
  {
    id: 'deal-smith',
    type: 'buy',
    clientName: 'Mike Smith',
    clientId: 'buyer-smith',
    agentId: 'agent-sarah',
    stage: 'under_contract',
    health: 'yellow',
    priority: 'high',
    property: {
      address: '456 Elm Street',
      city: 'Birmingham',
      state: 'AL',
      zip: '35203',
      price: 385000,
    },
    timeline: {
      createdAt: '2026-01-20T09:00:00Z',
      closingDate: '2026-03-15',
      daysInStage: 12,
      daysToClose: 60,
    },
    status: 'active',
    flags: ['fast_pass'],
    loanMilestones: {
      source: 'arive',
      loanSetup: true,
      disclosuresOut: true,
      disclosuresSignedSubmitted: false,
      approvedWithConditions: false,
      resubmittal: false,
      clearToClose: false,
      appraisal: 'scheduled',
      funded: false,
    },
    vendors: {
      lender: {
        company: 'Mountain Mortgage',
        contactName: 'Paul Leara',
        phone: '(205) 555-0199',
        email: 'paul@mountain.mortgage',
        loanOfficer: 'Paul Leara',
        isAriveIntegrated: true,
        portalUrl: 'https://portal.mountainmortgage.com',
      },
      titleCompany: {
        company: 'Alabama Title Group',
        contactName: 'Diane Foster',
        phone: '(205) 555-0142',
        email: 'dfoster@altitlegroup.com',
      },
      inspector: {
        company: 'BirminghamHome Inspections',
        contactName: 'Ray Simmons',
        phone: '(205) 555-0188',
        email: 'ray@bhi.com',
      },
      insurance: {
        company: 'State Farm — Birmingham',
        contactName: 'Karen Mills',
        phone: '(205) 555-0312',
        email: 'karen.mills@statefarm.com',
      },
    },
    estimatedCommission: 11550,
    notes: 'Disclosures pending — buyer needs to sign ARIVE disclosures ASAP.',
    fastPass: {
      enrolledAt: '2026-01-20T09:00:00Z',
      status: 'active',
      paymentOption: 'now',
      selectedUpsells: ['utility_setup', 'deep_clean', 'moving_coordination'],
      totalPaid: 3468,
      surveyAnswers: {
        currentSituation: 'renting',
        targetMoveDate: '2026-03-15',
        dateFlexibility: 'somewhat',
        moveSize: '2bed',
        moverPreference: 'coordinate',
        packingPreference: 'partial',
        utilities: ['Electric', 'Natural Gas', 'Internet'],
        notes: 'Need elevator access at the new building.',
      },
    },
  },
  {
    id: 'deal-garcia',
    type: 'buy',
    clientName: 'Alex Garcia',
    clientId: 'buyer-garcia',
    agentId: 'agent-sarah',
    stage: 'active_search',
    health: 'green',
    priority: 'medium',
    property: {
      address: 'Hoover / Vestavia Hills Area',
      city: 'Hoover',
      state: 'AL',
      zip: '35244',
      price: 350000,
    },
    timeline: {
      createdAt: '2026-02-07T10:00:00Z',
      daysInStage: 5,
    },
    status: 'active',
    flags: ['mountain_mortgage'],
    loanMilestones: {
      source: 'arive',
      loanSetup: false,
      disclosuresOut: false,
      disclosuresSignedSubmitted: false,
      approvedWithConditions: false,
      resubmittal: false,
      clearToClose: false,
      appraisal: null,
      funded: false,
    },
    vendors: {
      lender: {
        company: 'Mountain Mortgage',
        contactName: 'Paul Leara',
        phone: '(205) 555-0199',
        email: 'paul@mountain.mortgage',
        loanOfficer: 'Paul Leara',
        isAriveIntegrated: true,
        portalUrl: 'https://portal.mountainmortgage.com',
      },
    },
    estimatedCommission: 10500,
    notes: 'Buyer is pre-approval in progress with Mountain Mortgage. Targeting Hoover/Vestavia Hills.',
  },
  {
    id: 'deal-williams',
    type: 'sell',
    clientName: 'Jennifer Williams',
    clientId: 'seller-williams',
    agentId: 'agent-sarah',
    stage: 'under_contract',
    health: 'red',
    priority: 'high',
    property: {
      address: '789 Pine Drive',
      city: 'Birmingham',
      state: 'AL',
      zip: '35242',
      price: 410000,
    },
    timeline: {
      createdAt: '2026-01-08T09:00:00Z',
      closingDate: '2026-02-20',
      daysInStage: 18,
      daysToClose: 37,
    },
    status: 'active',
    flags: ['repair_request', 'fast_pass'],
    loanMilestones: {
      source: 'manual',
      loanSetup: true,
      disclosuresOut: true,
      disclosuresSignedSubmitted: true,
      approvedWithConditions: true,
      resubmittal: false,
      clearToClose: false,
      appraisal: 'scheduled',
      funded: false,
    },
    vendors: {
      lender: {
        company: 'Regions Bank',
        contactName: 'Tom Beckett',
        phone: '(205) 555-0177',
        email: 'tbeckett@regions.com',
        isAriveIntegrated: false,
      },
      titleCompany: {
        company: 'Alabama Title Group',
        contactName: 'Diane Foster',
        phone: '(205) 555-0142',
        email: 'dfoster@altitlegroup.com',
      },
      inspector: {
        company: 'BirminghamHome Inspections',
        contactName: 'Ray Simmons',
        phone: '(205) 555-0188',
        email: 'ray@bhi.com',
      },
    },
    estimatedCommission: 12300,
    notes: 'Buyer submitted repair request — seller needs to respond. List price was $420k, accepted at $410k.',
    smoothExit: {
      enrolledAt: '2026-01-08T10:00:00Z',
      status: 'active',
      estimatedSalePrice: 410000,
      fee: 4100,
      paymentOption: 'from_proceeds',
      buyingNext: true,
      nextStep: 'buying_local',
      surveyAnswers: {
        nextStep: 'buying_local',
        estimatedSalePrice: 410000,
        moveOutDate: '2026-02-20',
        needsBridgeFinancing: true,
        moverPreference: 'coordinate',
        wantsDeepClean: true,
        utilities: ['Electric', 'Natural Gas', 'Internet', 'Trash & Recycling'],
        notes: 'Need to buy before selling — looking in Vestavia Hills area.',
      },
    },
  },
  {
    id: 'deal-johnson',
    type: 'sell',
    clientName: 'Robert Johnson',
    clientId: 'seller-johnson',
    agentId: 'agent-sarah',
    stage: 'offer_active',
    health: 'green',
    priority: 'medium',
    property: {
      address: '123 Oak Lane',
      city: 'Birmingham',
      state: 'AL',
      zip: '35203',
      price: 385000,
    },
    timeline: {
      createdAt: '2026-02-10T08:00:00Z',
      daysInStage: 9,
    },
    status: 'active',
    flags: ['asap_timeline', 'also_buying'],
    vendors: {
      titleCompany: {
        company: 'Alabama Title Group',
        contactName: 'Diane Foster',
        phone: '(205) 555-0142',
        email: 'dfoster@altitlegroup.com',
      },
    },
    estimatedCommission: 11550,
    notes: 'Seller is also looking to buy. ASAP timeline — wants to list within 30 days.',
  },
  {
    id: 'deal-chen',
    type: 'buy',
    clientName: 'Kevin Chen',
    clientId: 'buyer-chen',
    agentId: 'agent-sarah',
    stage: 'intake',
    health: 'green',
    priority: 'medium',
    status: 'active',
    property: {
      address: 'Birmingham / Hoover Area',
      city: 'Birmingham',
      state: 'AL',
      zip: '35203',
      price: 0,
    },
    timeline: {
      createdAt: '2026-04-20T09:00:00Z',
      daysInStage: 2,
    },
    flags: ['mountain_mortgage'],
    estimatedCommission: 0,
    notes: 'New buyer — just started onboarding.',
  },
  {
    id: 'deal-davis',
    type: 'buy',
    clientName: 'Chris Davis',
    clientId: 'buyer-davis',
    agentId: 'agent-sarah',
    stage: 'intake',
    health: 'green',
    priority: 'medium',
    status: 'active',
    property: {
      address: 'Mountain Brook / Hoover Area',
      city: 'Mountain Brook',
      state: 'AL',
      zip: '35213',
      price: 425000,
    },
    timeline: {
      createdAt: '2026-04-22T09:00:00Z',
      closingDate: '2026-06-30',
      daysInStage: 0,
      daysToClose: 69,
    },
    flags: ['mountain_mortgage'],
    loanMilestones: {
      source: 'arive',
      loanSetup: false,
      disclosuresOut: false,
      disclosuresSignedSubmitted: false,
      approvedWithConditions: false,
      resubmittal: false,
      clearToClose: false,
      appraisal: null,
      funded: false,
    },
    vendors: {
      lender: {
        company: 'Mountain Mortgage',
        contactName: 'Paul Leara',
        phone: '(205) 401-9076',
        email: 'paul@mountain.mortgage',
        loanOfficer: 'Paul Leara',
        isAriveIntegrated: true,
        portalUrl: 'https://apply.mountainmortgage.com',
      },
    },
    estimatedCommission: 12750,
    notes: 'New buyer — targeting Mountain Brook / Hoover, budget ~$425k. Getting pre-approved with Mountain Mortgage.',
  },
];

export function getDealById(id: string): Deal | undefined {
  return MOCK_DEALS.find((deal) => deal.id === id);
}
