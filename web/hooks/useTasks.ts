"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Task } from "@/lib/data/mockTasks";
import { DealStage } from "@/lib/data/mockDeals";
import { apiTaskListSchema, type ApiTask } from "@/lib/schemas/task";
import { checkWire } from "@/lib/schemas/wire";

// The wire type is inferred from the zod schema (#88) — a single contract
// shared with the server boundary instead of a hand-maintained copy.
export type { ApiTask };

// Exported: this mapping is what the dashboard's "Tasks Due" / overdue
// counts are built on (a pending task past its due_date renders as overdue).
export function apiTaskToFrontend(t: ApiTask): Task {
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
      // Dev/test-only wire check (#88): warns on schema drift; no-op in prod.
      const raw = await api.get<ApiTask[]>('/tasks');
      return checkWire(apiTaskListSchema, raw, 'GET /api/tasks').map(apiTaskToFrontend);
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
      return checkWire(apiTaskListSchema, raw, 'GET /api/deals/:id/tasks').map(apiTaskToFrontend);
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

/** Edit a task's due date and/or assignee (agent-only server-side). */
export async function patchTask(
  taskId: string,
  fields: { status?: string; due_date?: string | null; assigned_to?: string | null },
): Promise<void> {
  await api.patch(`/tasks/${taskId}/status`, fields);
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
    assigned_to?: string;
  },
): Promise<void> {
  await api.post(`/deals/${dealId}/tasks`, task);
}
