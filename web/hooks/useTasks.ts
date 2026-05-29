"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Task } from "@/lib/data/mockTasks";
import { DealStage } from "@/lib/data/mockDeals";

type ApiTask = {
  id: string;
  deal_id: string;
  assigned_to: string | null;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  priority: string;
  source: string;
  stage_context: string | null;
  role: string;
  due_date: string | null;
  created_at: string;
  updated_at: string;
};

function apiTaskToFrontend(t: ApiTask): Task {
  let status: Task['status'] = t.status === 'skipped' ? 'pending' : t.status;
  if (status === 'pending' && t.due_date && new Date(t.due_date) < new Date()) {
    status = 'overdue';
  }
  return {
    id: t.id,
    dealId: t.deal_id,
    title: t.title,
    description: t.description ?? undefined,
    assignedTo: (t.role as Task['assignedTo']) ?? 'agent',
    assignedToId: t.assigned_to ?? '',
    status,
    priority: (t.priority as Task['priority']) ?? 'medium',
    source: (t.source as Task['source']) ?? 'manual',
    stageContext: (t.stage_context as DealStage) ?? 'intake',
    dueDate: t.due_date ?? undefined,
  };
}

export function useAgentTasks(): { tasks: Task[]; loading: boolean; refresh: () => void } {
  const query = useQuery({
    queryKey: ['agent-tasks'],
    queryFn: async () => {
      const raw = await api.get<ApiTask[]>('/tasks');
      return raw.map(apiTaskToFrontend);
    },
  });

  return {
    tasks: query.data ?? [],
    loading: query.isLoading,
    refresh: () => { void query.refetch(); },
  };
}

export function useTasks(dealId: string): { tasks: Task[]; loading: boolean; refresh: () => void } {
  const query = useQuery({
    queryKey: ['tasks', dealId],
    queryFn: async () => {
      const raw = await api.get<ApiTask[]>(`/deals/${dealId}/tasks`);
      return raw.map(apiTaskToFrontend);
    },
    enabled: Boolean(dealId),
  });

  return {
    tasks: query.data ?? [],
    loading: query.isLoading,
    refresh: () => { void query.refetch(); },
  };
}

export async function patchTaskStatus(taskId: string, status: string): Promise<void> {
  await api.patch(`/tasks/${taskId}/status`, { status });
}

export async function postTask(
  dealId: string,
  task: {
    title: string;
    description?: string;
    priority?: string;
    source?: string;
    stage_context?: string;
    role?: string;
    due_date?: string;
  },
): Promise<void> {
  await api.post(`/deals/${dealId}/tasks`, task);
}
