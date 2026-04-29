export type VendorCategory =
  | 'homeowners_insurance'
  | 'home_inspector'
  | 'pest_inspector'
  | 'plumber'
  | 'electrician'
  | 'hvac'
  | 'roofer'
  | 'painter'
  | 'landscaping'
  | 'cleaning'
  | 'movers'
  | 'appraiser'
  | 'photographer'
  | 'staging'
  | 'handyman';

export const VENDOR_CATEGORY_LABELS: Record<VendorCategory, string> = {
  homeowners_insurance: 'Homeowners Insurance',
  home_inspector: 'Home Inspector',
  pest_inspector: 'Pest Inspector',
  plumber: 'Plumber',
  electrician: 'Electrician',
  hvac: 'HVAC',
  roofer: 'Roofer',
  painter: 'Painter',
  landscaping: 'Landscaping',
  cleaning: 'Cleaning',
  movers: 'Movers',
  appraiser: 'Appraiser',
  photographer: 'Photographer',
  staging: 'Staging',
  handyman: 'Handyman / Repairs',
};

export const VENDOR_CATEGORY_ORDER: VendorCategory[] = [
  'homeowners_insurance',
  'home_inspector',
  'pest_inspector',
  'plumber',
  'electrician',
  'hvac',
  'roofer',
  'painter',
  'handyman',
  'landscaping',
  'cleaning',
  'movers',
  'appraiser',
  'photographer',
  'staging',
];

export type PreferredVendor = {
  id: string;
  agentId: string;
  category: VendorCategory;
  company: string;
  contactName?: string;
  phone?: string;
  email?: string;
  website?: string;
  /** Short note surfaced to clients — e.g. "Ask for Mike" or "Best for older homes" */
  notes?: string;
  /** Top pick in this category — shown with a star */
  isFeatured: boolean;
};

export const MOCK_PREFERRED_VENDORS: PreferredVendor[] = [
  // ── Homeowners Insurance ─────────────────────────────────────────────────────
  {
    id: 'pv-ins-1',
    agentId: 'agent-sarah',
    category: 'homeowners_insurance',
    company: 'State Farm — Birmingham',
    contactName: 'Karen Mills',
    phone: '(205) 555-0312',
    email: 'karen.mills@statefarm.com',
    notes: 'Fast binders — can get proof of insurance same day',
    isFeatured: true,
  },
  {
    id: 'pv-ins-2',
    agentId: 'agent-sarah',
    category: 'homeowners_insurance',
    company: 'Allstate — Hoover Office',
    contactName: 'Derek Fountain',
    phone: '(205) 555-0387',
    email: 'd.fountain@allstate.com',
    isFeatured: false,
  },
  {
    id: 'pv-ins-3',
    agentId: 'agent-sarah',
    category: 'homeowners_insurance',
    company: 'Bryant Insurance Group',
    contactName: 'Lisa Bryant',
    phone: '(205) 555-0419',
    email: 'lisa@bryantinsurance.com',
    notes: 'Independent broker — shops multiple carriers for best rate',
    isFeatured: false,
  },

  // ── Home Inspectors ──────────────────────────────────────────────────────────
  {
    id: 'pv-1',
    agentId: 'agent-sarah',
    category: 'home_inspector',
    company: 'BirminghamHome Inspections',
    contactName: 'Ray Simmons',
    phone: '(205) 555-0188',
    email: 'ray@bhi.com',
    isFeatured: true,
  },
  {
    id: 'pv-2',
    agentId: 'agent-sarah',
    category: 'home_inspector',
    company: 'Alabama Property Inspections',
    contactName: 'Dave Norris',
    phone: '(205) 555-0221',
    email: 'dave@alproinspect.com',
    notes: 'Specializes in older and historic homes',
    isFeatured: false,
  },
  {
    id: 'pv-3',
    agentId: 'agent-sarah',
    category: 'home_inspector',
    company: 'Metro Home Inspectors',
    contactName: 'Lisa Huang',
    phone: '(205) 555-0305',
    email: 'lisa@metroinspect.com',
    isFeatured: false,
  },

  // ── Pest Inspectors ───────────────────────────────────────────────────────────
  {
    id: 'pv-4',
    agentId: 'agent-sarah',
    category: 'pest_inspector',
    company: 'Terminix Birmingham',
    contactName: 'Carlos Rivera',
    phone: '(205) 555-0142',
    isFeatured: true,
  },
  {
    id: 'pv-5',
    agentId: 'agent-sarah',
    category: 'pest_inspector',
    company: 'Orkin Birmingham',
    phone: '(205) 555-0188',
    isFeatured: false,
  },

  // ── Plumbers ──────────────────────────────────────────────────────────────────
  {
    id: 'pv-6',
    agentId: 'agent-sarah',
    category: 'plumber',
    company: 'Birmingham Plumbing Co.',
    contactName: 'Mike Tanner',
    phone: '(205) 555-0177',
    isFeatured: true,
  },

  // ── Electricians ──────────────────────────────────────────────────────────────
  {
    id: 'pv-7',
    agentId: 'agent-sarah',
    category: 'electrician',
    company: 'Bright Electric',
    contactName: 'Tom Walsh',
    phone: '(205) 555-0156',
    email: 'tom@brightelectric.com',
    isFeatured: true,
  },

  // ── HVAC ──────────────────────────────────────────────────────────────────────
  {
    id: 'pv-8',
    agentId: 'agent-sarah',
    category: 'hvac',
    company: 'Cool Air HVAC',
    contactName: 'Sandra Lee',
    phone: '(205) 555-0201',
    notes: 'Ask about their service contract — great rates for new homeowners',
    isFeatured: true,
  },

  // ── Roofers ───────────────────────────────────────────────────────────────────
  {
    id: 'pv-9',
    agentId: 'agent-sarah',
    category: 'roofer',
    company: 'Vulcan Roofing',
    contactName: 'Jim Becker',
    phone: '(205) 555-0244',
    isFeatured: true,
  },

  // ── Painters ─────────────────────────────────────────────────────────────────
  {
    id: 'pv-10',
    agentId: 'agent-sarah',
    category: 'painter',
    company: 'Fresh Coat Painters',
    contactName: 'Jose Martinez',
    phone: '(205) 555-0345',
    isFeatured: true,
  },

  // ── Handyman ─────────────────────────────────────────────────────────────────
  {
    id: 'pv-11',
    agentId: 'agent-sarah',
    category: 'handyman',
    company: 'Fix-It All Handyman Services',
    contactName: 'Bill Carey',
    phone: '(205) 555-0277',
    notes: 'Great for pre-listing punch list repairs',
    isFeatured: true,
  },

  // ── Landscaping ───────────────────────────────────────────────────────────────
  {
    id: 'pv-12',
    agentId: 'agent-sarah',
    category: 'landscaping',
    company: 'Green Thumb Landscaping',
    contactName: 'Tina Marsh',
    phone: '(205) 555-0133',
    isFeatured: true,
  },

  // ── Cleaning ─────────────────────────────────────────────────────────────────
  {
    id: 'pv-13',
    agentId: 'agent-sarah',
    category: 'cleaning',
    company: 'Sparkling Clean Co.',
    contactName: 'Maria Gutierrez',
    phone: '(205) 555-0168',
    notes: 'Specializes in move-in / move-out deep cleans',
    isFeatured: true,
  },

  // ── Movers ───────────────────────────────────────────────────────────────────
  {
    id: 'pv-14',
    agentId: 'agent-sarah',
    category: 'movers',
    company: 'Magic City Movers',
    contactName: 'Derek James',
    phone: '(205) 555-0299',
    email: 'derek@magiccitymovers.com',
    isFeatured: true,
  },

  // ── Appraisers ────────────────────────────────────────────────────────────────
  {
    id: 'pv-15',
    agentId: 'agent-sarah',
    category: 'appraiser',
    company: 'Alabama Property Appraisers',
    contactName: 'Robert Chen',
    phone: '(205) 555-0222',
    isFeatured: true,
  },

  // ── Photographers ────────────────────────────────────────────────────────────
  {
    id: 'pv-16',
    agentId: 'agent-sarah',
    category: 'photographer',
    company: 'Pixel Perfect RE Photography',
    contactName: 'Ashley Kim',
    phone: '(205) 555-0311',
    email: 'ashley@pixelperfectphoto.com',
    isFeatured: true,
  },

  // ── Staging ───────────────────────────────────────────────────────────────────
  {
    id: 'pv-17',
    agentId: 'agent-sarah',
    category: 'staging',
    company: 'Stage & Sell Birmingham',
    contactName: 'Priya Nair',
    phone: '(205) 555-0388',
    notes: 'Offers virtual staging for vacant properties too',
    isFeatured: true,
  },
];

export function getPreferredVendorsByAgent(agentId: string): PreferredVendor[] {
  return MOCK_PREFERRED_VENDORS.filter((v) => v.agentId === agentId);
}
