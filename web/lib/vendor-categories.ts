// Vendor category taxonomy shared by the vendor directory, settings page,
// and deal Vendors tab (formerly lib/data/mockVendors.ts — renamed in #89;
// the mock preferred-vendor seed data was deleted, real vendors come from
// /api/vendors via hooks/useVendors).

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
