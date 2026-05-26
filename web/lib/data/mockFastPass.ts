export const FAST_PASS_BASE_PRICE = 2977;

export type FastPassUpsellId =
  | 'utility_setup'
  | 'refi_monitoring'
  | 'home_warranty'
  | 'deep_clean'
  | 'inspection_followup'
  | 'address_change'
  | 'storage_research'
  | 'new_construction'
  | 'staging_consult'
  | 'moving_coordination';

export type FastPassUpsell = {
  id: FastPassUpsellId;
  name: string;
  tagline: string;
  details: string[];
  price: number;
};

export const FAST_PASS_BASE_FEATURES: string[] = [
  '10-day close track with Mountain Mortgage',
  '2% lender credit for a refinance — available any time after 7 months from purchase',
  'Dedicated concierge — available 7 days a week',
  'Front-of-line priority across all vendor scheduling',
  'Interior designer move-in consultation (1 session)',
  'Moving company coordination & scheduling',
  'Admin task automation (title, insurance, inspections)',
  'Buy Before You Sell — bridge financing coordination if you currently own a home',
];

export const FAST_PASS_UPSELLS: FastPassUpsell[] = [
  {
    id: 'utility_setup',
    name: 'Utility Setup Concierge',
    tagline: "We handle every utility transfer so you don't have to make a single call.",
    details: [
      'Electric, gas, water, internet, and trash services',
      'We contact providers and schedule start dates',
      'Coordinate cancellations at your current address',
    ],
    price: 97,
  },
  {
    id: 'refi_monitoring',
    name: 'Rate Refi Monitoring',
    tagline: '24-month rate watch — we alert you the moment refinancing makes sense.',
    details: [
      'We track market rates against your locked rate daily',
      'Text + email alert when breakeven threshold is crossed',
      'Free Mountain Mortgage refinance analysis on request',
    ],
    price: 147,
  },
  {
    id: 'home_warranty',
    name: 'Home Warranty Coordination',
    tagline: 'We research, compare, and activate your 1-year home warranty.',
    details: [
      'We shop 3+ warranty providers and present your best option',
      'Coordinate enrollment and payment before closing',
      'Summary of coverage delivered to your portal',
    ],
    price: 97,
  },
  {
    id: 'deep_clean',
    name: 'Post-Close Deep Clean',
    tagline: 'Move into a spotless home — no scrubbing required.',
    details: [
      'Full interior deep clean scheduled around your move-in',
      'Includes kitchen appliances, bathrooms, floors, and windows',
      'Coordinated with our preferred cleaning partner',
    ],
    price: 197,
  },
  {
    id: 'inspection_followup',
    name: 'Inspection Report Follow-Up',
    tagline: 'Every item on your inspection report tracked to completion.',
    details: [
      'We log all inspection findings and assign vendor follow-up',
      'Repair estimates coordinated before your repair request deadline',
      'Updates posted to your portal as items resolve',
    ],
    price: 147,
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
    price: 97,
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
    price: 97,
  },
  {
    id: 'new_construction',
    name: 'New Construction Walkthrough Prep',
    tagline: 'For new builds — we prep your punch list and attend with you.',
    details: [
      'We review your build plans and flag common issues',
      'Detailed punch list checklist delivered before walkthrough',
      'Concierge available by phone during your final walkthrough',
    ],
    price: 147,
  },
  {
    id: 'staging_consult',
    name: 'Staging & Design Consultation',
    tagline: 'A professional interior designer plans your new space before you move in.',
    details: [
      '90-minute virtual or in-person session with a designer',
      'Room-by-room layout recommendations and style guide',
      'Furniture sourcing suggestions within your budget',
    ],
    price: 247,
  },
  {
    id: 'moving_coordination',
    name: 'Moving Day Coordination',
    tagline: 'We manage your moving company so moving day goes smoothly.',
    details: [
      'Confirm mover arrival window, crew size, and access instructions',
      'Coordinate elevator reservations or building requirements',
      'Moving day guide delivered 48 hours before your move',
    ],
    price: 197,
  },
];

export type FastPassEnrollmentStatus = 'pending_payment' | 'active' | 'complete' | 'collected';

export type FastPassPaymentOption = 'now' | 'at_closing' | 'seller_concession';

export type FastPassSurveyAnswers = {
  currentSituation: string;
  targetMoveDate: string;
  dateFlexibility: string;
  moveSize: string;
  moverPreference: string;
  packingPreference: string;
  utilities: string[];
  notes: string;
};

export type FastPassEnrollment = {
  enrolledAt: string;
  status: FastPassEnrollmentStatus;
  paymentOption: FastPassPaymentOption;
  selectedUpsells: FastPassUpsellId[];
  totalPaid: number;
  surveyAnswers?: FastPassSurveyAnswers;
};

export function calcFastPassTotal(upsells: FastPassUpsellId[]): number {
  const upsellTotal = FAST_PASS_UPSELLS
    .filter((u) => upsells.includes(u.id))
    .reduce((sum, u) => sum + u.price, 0);
  return FAST_PASS_BASE_PRICE + upsellTotal;
}
