import { DealStage } from './mockDeals';

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
