// Fast Pass marketing/display copy shown in the buyer onboarding flow and
// admin dashboard (formerly lib/data/mockFastPass.ts — renamed in #89; this
// is live UI content, not mock data).
//
// Prices derive from lib/fast-pass-catalog.ts (cents) so the dollars shown
// here always equal what POST /deals/[id]/fastpass charges (#78). Edit the
// catalog, not these numbers.
import {
  FAST_PASS_BASE_PRICE_CENTS,
  FAST_PASS_UPSELL_PRICE_CENTS,
  type FastPassUpsellId,
} from '@/lib/fast-pass-catalog';

export type { FastPassUpsellId };

export const FAST_PASS_BASE_PRICE = FAST_PASS_BASE_PRICE_CENTS / 100;

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
    price: FAST_PASS_UPSELL_PRICE_CENTS.utility_setup / 100,
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
    price: FAST_PASS_UPSELL_PRICE_CENTS.refi_monitoring / 100,
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
    price: FAST_PASS_UPSELL_PRICE_CENTS.home_warranty / 100,
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
    price: FAST_PASS_UPSELL_PRICE_CENTS.deep_clean / 100,
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
    price: FAST_PASS_UPSELL_PRICE_CENTS.inspection_followup / 100,
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
    price: FAST_PASS_UPSELL_PRICE_CENTS.address_change / 100,
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
    price: FAST_PASS_UPSELL_PRICE_CENTS.storage_research / 100,
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
    price: FAST_PASS_UPSELL_PRICE_CENTS.new_construction / 100,
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
    price: FAST_PASS_UPSELL_PRICE_CENTS.staging_consult / 100,
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
    price: FAST_PASS_UPSELL_PRICE_CENTS.moving_coordination / 100,
  },
];

export function calcFastPassTotal(upsells: FastPassUpsellId[]): number {
  const upsellTotal = FAST_PASS_UPSELLS
    .filter((u) => upsells.includes(u.id))
    .reduce((sum, u) => sum + u.price, 0);
  return FAST_PASS_BASE_PRICE + upsellTotal;
}
