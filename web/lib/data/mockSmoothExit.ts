import {
  SMOOTH_EXIT_UPSELL_PRICE_CENTS,
  type SmoothExitUpsellId,
} from '../smooth-exit-catalog';

export type { SmoothExitUpsellId };

export const SMOOTH_EXIT_FEE_PERCENT = 0.01; // 1% of sale price

export type SmoothExitNextStep =
  | 'buying_local'
  | 'buying_out_of_state'
  | 'downsizing'
  | 'renting'
  | 'retirement'
  | 'family'
  | 'not_sure';

export const NEXT_STEP_LABELS: Record<SmoothExitNextStep, string> = {
  buying_local: 'Buying another home (local)',
  buying_out_of_state: 'Buying another home (out of state)',
  downsizing: 'Downsizing to a smaller home',
  renting: 'Renting next',
  retirement: 'Moving to a retirement / 55+ community',
  family: 'Moving in with family',
  not_sure: 'Not sure yet',
};

export function nextStepQualifiesForBridge(step: SmoothExitNextStep): boolean {
  return ['buying_local', 'buying_out_of_state', 'downsizing'].includes(step);
}

export const SMOOTH_EXIT_FEATURES: string[] = [
  'Buy Before You Sell — bridge financing coordination (any lender, Mountain Mortgage preferred)',
  'Move-out coordination: movers, deep clean, and utility cancellations',
  'USPS mail forwarding + address change notifications',
  'Repair request response coordination on behalf of seller',
  'Disclosure packet organization and tracking',
  'Title company communication through closing',
  'Proceeds wiring confirmation and closing-day support',
];

export type SmoothExitPaymentOption = 'from_proceeds' | 'buyer_concession';

export type SmoothExitSurveyAnswers = {
  nextStep: SmoothExitNextStep;
  estimatedSalePrice: number;
  moveOutDate: string;
  needsBridgeFinancing: boolean;
  moverPreference: string;
  wantsDeepClean: boolean;
  utilities: string[];
  notes: string;
};

export type SmoothExitEnrollmentStatus = 'pending' | 'active' | 'complete';

export type SmoothExitEnrollment = {
  enrolledAt: string;
  status: SmoothExitEnrollmentStatus;
  estimatedSalePrice: number;
  fee: number;
  paymentOption: SmoothExitPaymentOption;
  buyingNext: boolean;
  nextStep?: SmoothExitNextStep;
  surveyAnswers?: SmoothExitSurveyAnswers;
  selectedUpsells?: string[];
  upsellTotalCents?: number;
  upsellsPaid?: boolean;
};

export function calcSmoothExitFee(salePrice: number): number {
  return Math.round(salePrice * SMOOTH_EXIT_FEE_PERCENT);
}

export type SmoothExitUpsell = {
  id: SmoothExitUpsellId;
  name: string;
  tagline: string;
  details: string[];
  price: number;
};

// Display prices derive from the server-side catalog (lib/smooth-exit-catalog.ts)
// so the UI can never drift from what POST /deals/[id]/smoothexit charges.
const dollars = (id: SmoothExitUpsellId): number =>
  SMOOTH_EXIT_UPSELL_PRICE_CENTS[id] / 100;

export const SMOOTH_EXIT_UPSELLS: SmoothExitUpsell[] = [
  {
    id: 'pre_listing_clean',
    name: 'Pre-Listing Deep Clean',
    tagline: 'Go on market spotless — we schedule a professional clean before photos.',
    details: [
      'Full interior deep clean before listing photos',
      'Includes kitchen appliances, bathrooms, floors, and windows',
      'Coordinated around your photo shoot date',
    ],
    price: dollars('pre_listing_clean'),
  },
  {
    id: 'staging_consult',
    name: 'Staging & Design Consultation',
    tagline: 'A professional designer helps you show your home at its best.',
    details: [
      '90-minute virtual or in-person session before listing',
      'Room-by-room staging recommendations',
      'Decluttering and furniture arrangement guide',
    ],
    price: dollars('staging_consult'),
  },
  {
    id: 'pre_listing_inspection',
    name: 'Pre-Listing Inspection Coordination',
    tagline: 'Know your home inside out before buyers do — zero surprises.',
    details: [
      'We schedule and coordinate your pre-listing inspection',
      'Summary of findings delivered before you list',
      'Vendor quotes for any items you choose to address',
    ],
    price: dollars('pre_listing_inspection'),
  },
  {
    id: 'photography_upgrade',
    name: 'Photography & Marketing Upgrade',
    tagline: '3D walkthrough tour + drone photography for listings that stop the scroll.',
    details: [
      'Matterport 3D virtual tour added to your listing',
      'Aerial drone photography for curb appeal shots',
      "Coordinated with your listing agent's photographer",
    ],
    price: dollars('photography_upgrade'),
  },
  {
    id: 'storage_research',
    name: 'Storage & Temp Housing Research',
    tagline: 'Need a gap between homes? We find the best options for you.',
    details: [
      'Research and compare local storage unit options',
      'Source short-term rental or hotel options if needed',
      'Coordinate reservations and access instructions',
    ],
    price: dollars('storage_research'),
  },
  {
    id: 'moving_coordination',
    name: 'Moving Day Coordination',
    tagline: 'We manage your moving company so move-out day runs like clockwork.',
    details: [
      'Confirm mover arrival window, crew size, and access instructions',
      'Coordinate building or HOA requirements for move-out',
      'Moving day guide delivered 48 hours before your move',
    ],
    price: dollars('moving_coordination'),
  },
  {
    id: 'address_change',
    name: 'Address Change Coordination',
    tagline: 'One briefing. We handle the rest of your change-of-address.',
    details: [
      'USPS mail forwarding setup',
      'Personalized checklist of accounts to update (bank, DMV, subscriptions)',
      'We initiate key notifications on your behalf',
    ],
    price: dollars('address_change'),
  },
  {
    id: 'repair_bid_coordination',
    name: 'Repair Bid Coordination',
    tagline: 'We get 2–3 contractor bids before you respond to any repair request.',
    details: [
      'We reach out to licensed contractors within 24 hours of a repair request',
      'Bids compiled and delivered so you can negotiate from facts, not guesswork',
      'Covers up to 3 repair line items from the buyer\'s request',
    ],
    price: dollars('repair_bid_coordination'),
  },
];

export function calcSmoothExitUpsellTotal(upsells: SmoothExitUpsellId[]): number {
  return SMOOTH_EXIT_UPSELLS
    .filter((u) => upsells.includes(u.id))
    .reduce((sum, u) => sum + u.price, 0);
}
