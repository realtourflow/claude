export type PropertyStatus = 'interested' | 'toured' | 'not_for_me' | 'offer_submitted';

export type TrackedProperty = {
  id: string;
  dealId: string;
  address: string;
  city: string;
  state: string;
  price: number;
  beds: number;
  baths: number;
  sqft: number;
  thumbnailUrl: string;
  sourceUrl: string;
  status: PropertyStatus;
  addedBy: 'buyer' | 'agent';
  agentNote?: string;
  buyerNote?: string;
  agentPrivateNote?: string;
  offerRequested?: boolean;
};

export const MOCK_TRACKED_PROPERTIES: TrackedProperty[] = [
  {
    id: 'prop-garcia-1',
    dealId: 'deal-garcia',
    address: '3402 Shades Crest Rd',
    city: 'Vestavia Hills',
    state: 'AL',
    price: 389000,
    beds: 4,
    baths: 2.5,
    sqft: 2840,
    thumbnailUrl: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=400&q=80',
    sourceUrl: 'https://www.zillow.com',
    status: 'interested',
    addedBy: 'agent',
    agentNote: 'Just listed — matches your wish list. Vestavia schools, large backyard, walk-in closets.',
  },
  {
    id: 'prop-garcia-2',
    dealId: 'deal-garcia',
    address: '718 Old Rocky Ridge Rd',
    city: 'Hoover',
    state: 'AL',
    price: 342000,
    beds: 3,
    baths: 2,
    sqft: 2100,
    thumbnailUrl: 'https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=400&q=80',
    sourceUrl: 'https://www.zillow.com',
    status: 'toured',
    addedBy: 'buyer',
    buyerNote: 'Loved the layout but the backyard is small. Parking was tight.',
  },
  {
    id: 'prop-garcia-3',
    dealId: 'deal-garcia',
    address: '2215 Columbiana Rd',
    city: 'Hoover',
    state: 'AL',
    price: 315000,
    beds: 3,
    baths: 2,
    sqft: 1950,
    thumbnailUrl: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=400&q=80',
    sourceUrl: '',
    status: 'not_for_me',
    addedBy: 'buyer',
  },
  {
    id: 'prop-davis-1',
    dealId: 'deal-davis',
    address: '3125 Euclid Ave',
    city: 'Mountain Brook',
    state: 'AL',
    price: 449000,
    beds: 4,
    baths: 3,
    sqft: 3100,
    thumbnailUrl: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=400&q=80',
    sourceUrl: 'https://www.zillow.com',
    status: 'interested',
    addedBy: 'agent',
    agentNote: 'Top pick — Mountain Brook schools, large lot, updated kitchen. Priced to move.',
  },
  {
    id: 'prop-davis-2',
    dealId: 'deal-davis',
    address: '1840 Patton Chapel Rd',
    city: 'Hoover',
    state: 'AL',
    price: 399000,
    beds: 4,
    baths: 2.5,
    sqft: 2650,
    thumbnailUrl: 'https://images.unsplash.com/photo-1598228723793-52759bba239c?w=400&q=80',
    sourceUrl: 'https://www.zillow.com',
    status: 'interested',
    addedBy: 'agent',
    agentNote: 'Great value in Hoover — quiet cul-de-sac, open floor plan, 3-car garage.',
  },
];
