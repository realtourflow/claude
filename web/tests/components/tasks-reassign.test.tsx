// @vitest-environment happy-dom
/**
 * TasksTab reassignment persistence (#255).
 *
 * The reassign dropdown used to write only to a browser-only zustand store
 * (`assigneeOverrides`), so an agent↔TC handoff vanished on reload / other
 * device / TC session. It must now PATCH the server (the task's `role`) and
 * refetch — the server is the source of truth, no in-memory override.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TasksTab } from "@/components/deal/TasksTab";
import type { Deal, Task } from "@/lib/types";

const patchTask = vi.fn();
const patchTaskStatus = vi.fn();
const postTask = vi.fn();
vi.mock("@/hooks/useTasks", () => ({
  useTasks: vi.fn(() => ({ tasks: [], loading: false, refresh: vi.fn() })),
  useAgentTasks: vi.fn(() => ({ tasks: [], loading: false, refresh: vi.fn() })),
  postTask: (...a: unknown[]) => postTask(...a),
  patchTask: (...a: unknown[]) => patchTask(...a),
  patchTaskStatus: (...a: unknown[]) => patchTaskStatus(...a),
  apiTaskToFrontend: vi.fn(),
}));

// Grant every permission — server-side scoping is the security boundary;
// here we only exercise the agent UI (assign is agent/admin-gated).
vi.mock("@/permissions/usePermission", () => ({
  usePermission: () => ({
    can: () => true,
    canAny: () => true,
    canAll: () => true,
    currentGroup: "agent",
    hasPermission: () => true,
  }),
}));

const DEAL = {
  id: "deal-1",
  clientName: "Jane Doe",
  stage: "under_contract",
  type: "buy",
} as unknown as Deal;

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    dealId: "deal-1",
    title: "Order title report",
    assignedTo: "agent",
    assignedToId: "",
    status: "pending",
    priority: "medium",
    source: "manual",
    stageContext: "under_contract",
    dueDate: "2026-07-20",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  patchTask.mockResolvedValue(undefined);
  patchTaskStatus.mockResolvedValue(undefined);
  postTask.mockResolvedValue(undefined);
});

describe("TasksTab — reassign persists to the server (#255)", () => {
  it("PATCHes the new role, refetches, and regroups from server data", async () => {
    const user = userEvent.setup();
    const onTasksChange = vi.fn();
    const { rerender } = render(
      <TasksTab deal={DEAL} tasks={[makeTask()]} onTasksChange={onTasksChange} />
    );

    // Starts under the agent's "Your Tasks" section.
    expect(screen.getByText("Your Tasks")).toBeInTheDocument();

    // Open the assign dropdown (its button shows the current assignee label)
    // and hand the task to the TC.
    await user.click(screen.getByRole("button", { name: "Agent" }));
    await user.click(screen.getByRole("button", { name: "TC" }));

    await waitFor(() =>
      expect(patchTask).toHaveBeenCalledWith("task-1", { role: "tc" })
    );
    // Refetch is requested — the parent reloads authoritative task data.
    expect(onTasksChange).toHaveBeenCalled();

    // Server is the source of truth: the refetch returns the task under its
    // new role, and the tab regroups it into "TC / Third Party" (no override
    // store keeping it under the agent).
    rerender(
      <TasksTab
        deal={DEAL}
        tasks={[makeTask({ assignedTo: "tc" })]}
        onTasksChange={onTasksChange}
      />
    );
    expect(screen.getByText("TC / Third Party")).toBeInTheDocument();
    expect(screen.queryByText("Your Tasks")).not.toBeInTheDocument();
    expect(screen.getByText("Order title report")).toBeInTheDocument();
  });

  it("does not swallow the change into a browser-only store — it calls the API", async () => {
    const user = userEvent.setup();
    const onTasksChange = vi.fn();
    render(
      <TasksTab deal={DEAL} tasks={[makeTask()]} onTasksChange={onTasksChange} />
    );

    await user.click(screen.getByRole("button", { name: "Agent" }));
    await user.click(screen.getByRole("button", { name: "Seller (Client)" }));

    await waitFor(() =>
      expect(patchTask).toHaveBeenCalledWith("task-1", { role: "seller" })
    );
  });
});
