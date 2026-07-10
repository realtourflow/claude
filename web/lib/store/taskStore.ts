"use client";

import { create } from 'zustand';
import { Task } from "@/lib/data/mockTasks";

// NOTE: real task creation persists via POST /api/deals/:id/tasks (see
// TasksTab in DealDetail). The old client-only addTask/addedTasks/dismissTask
// were dead code and were removed in #187. Assignee overrides remain
// client-side until reassignment persistence ships with the portal/handoff
// work.
type TaskStore = {
  assigneeOverrides: Record<string, Task['assignedTo']>;
  reassign: (taskId: string, assignee: Task['assignedTo']) => void;
  effectiveAssignee: (task: Task) => Task['assignedTo'];
};

export const useTaskStore = create<TaskStore>((set, get) => ({
  assigneeOverrides: {},

  reassign: (taskId, assignee) =>
    set((state) => ({
      assigneeOverrides: { ...state.assigneeOverrides, [taskId]: assignee },
    })),

  effectiveAssignee: (task) =>
    get().assigneeOverrides[task.id] ?? task.assignedTo,
}));
