import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { Task } from '../data/mockTasks';
import { DealStage } from '../data/mockDeals';

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

export function useAgentTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const raw = await api.get<ApiTask[]>('/tasks');
      setTasks(raw.map(apiTaskToFrontend));
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { tasks, loading, refresh: load };
}

export function useTasks(dealId: string) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!dealId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const raw = await api.get<ApiTask[]>(`/deals/${dealId}/tasks`);
      setTasks(raw.map(apiTaskToFrontend));
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    load();
  }, [load]);

  return { tasks, loading, refresh: load };
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
