import { GroupId } from '../permissions/groups';

export type MockUser = {
  id: string;
  name: string;
  email: string;
  avatar: string;
  groupId: GroupId;
  role: string;
  dealIds: string[];
};

export const MOCK_USERS: MockUser[] = [
  {
    id: 'agent-sarah',
    name: 'Sarah Johnson',
    email: 'sarah@realtourflow.com',
    avatar: 'https://i.pravatar.cc/100?img=47',
    groupId: 'agent',
    role: 'Agent',
    dealIds: ['deal-smith', 'deal-garcia', 'deal-williams', 'deal-johnson', 'deal-chen', 'deal-davis'],
  },
  {
    id: 'admin-paul',
    name: 'Paul Leara',
    email: 'paul@mountain.mortgage',
    avatar: 'https://i.pravatar.cc/100?img=12',
    groupId: 'admin',
    role: 'Admin',
    dealIds: ['deal-smith', 'deal-garcia', 'deal-williams', 'deal-johnson', 'deal-chen', 'deal-davis'],
  },
  {
    id: 'buyer-smith',
    name: 'Mike Smith',
    email: 'mike.smith@email.com',
    avatar: 'https://i.pravatar.cc/100?img=33',
    groupId: 'buyer',
    role: 'Buyer',
    dealIds: ['deal-smith'],
  },
  {
    id: 'buyer-garcia',
    name: 'Alex Garcia',
    email: 'alex.garcia@email.com',
    avatar: 'https://i.pravatar.cc/100?img=22',
    groupId: 'buyer',
    role: 'Buyer',
    dealIds: ['deal-garcia'],
  },
  {
    id: 'seller-williams',
    name: 'Jennifer Williams',
    email: 'j.williams@email.com',
    avatar: 'https://i.pravatar.cc/100?img=5',
    groupId: 'seller',
    role: 'Seller',
    dealIds: ['deal-williams'],
  },
  {
    id: 'seller-johnson',
    name: 'Robert Johnson',
    email: 'r.johnson@email.com',
    avatar: 'https://i.pravatar.cc/100?img=15',
    groupId: 'seller',
    role: 'Seller',
    dealIds: ['deal-johnson'],
  },
  {
    id: 'buyer-chen',
    name: 'Kevin Chen',
    email: 'k.chen@email.com',
    avatar: 'https://i.pravatar.cc/100?img=68',
    groupId: 'buyer',
    role: 'Buyer',
    dealIds: ['deal-chen'],
  },
  {
    id: 'buyer-davis',
    name: 'Chris Davis',
    email: 'chris.davis@email.com',
    avatar: 'https://i.pravatar.cc/100?img=11',
    groupId: 'buyer',
    role: 'Buyer',
    dealIds: ['deal-davis'],
  },
  {
    id: 'tc-taylor',
    name: 'Jamie Taylor',
    email: 'jamie@realtourflow.com',
    avatar: 'https://i.pravatar.cc/100?img=56',
    groupId: 'tc',
    role: 'Transaction Coordinator',
    dealIds: ['deal-smith', 'deal-williams'],
  },
];

export const DEFAULT_USER_ID = 'agent-sarah';
