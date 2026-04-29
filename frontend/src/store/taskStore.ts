import { create } from 'zustand';
import { Task } from '../data/mockTasks';

type TaskStore = {
  assigneeOverrides: Record<string, Task['assignedTo']>;
  addedTasks: Task[];
  reassign: (taskId: string, assignee: Task['assignedTo']) => void;
  effectiveAssignee: (task: Task) => Task['assignedTo'];
  addTask: (task: Task) => void;
  dismissTask: (taskId: string) => void;
};

export const useTaskStore = create<TaskStore>((set, get) => ({
  assigneeOverrides: {},
  addedTasks: [],

  reassign: (taskId, assignee) =>
    set((state) => ({
      assigneeOverrides: { ...state.assigneeOverrides, [taskId]: assignee },
    })),

  effectiveAssignee: (task) =>
    get().assigneeOverrides[task.id] ?? task.assignedTo,

  addTask: (task) =>
    set((state) => ({
      addedTasks: [...state.addedTasks, task],
    })),

  dismissTask: (taskId) =>
    set((state) => ({
      addedTasks: state.addedTasks.filter((t) => t.id !== taskId),
    })),
}));
