// @vitest-environment happy-dom
/**
 * Regression test for buyer/seller portal task completion (#79 / T11).
 *
 * The buyer & seller portals faked their core action: `handleComplete` only
 * did `setCompletedIds((prev) => new Set([...prev, id]))` — a write-only local
 * Set, NO API call. So the agent/TC never saw the completion and it reappeared
 * on reload. The handler must instead call patchTaskStatus(taskId, 'completed')
 * so the server is the source of truth, optimistically check the task, roll the
 * check back on failure, and surface a visible error (never a silent success).
 *
 * This renders the real BuyerView container with its data hooks mocked and
 * drives the actual TaskCard confirm button the buyer clicks. On the OLD code
 * the patchTaskStatus assertion fails (handleComplete never calls it).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Task } from "@/lib/data/mockTasks";
import type { MyDeal } from "@/hooks/useMyDeals";

// ── Mocks ────────────────────────────────────────────────────────────────────
// Child components that pull their own data hooks (and would otherwise need a
// QueryClient / Auth0 context) are stubbed to nothing — they're irrelevant to
// task completion and keep the render light.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/ClientNotifications", () => ({ default: () => null }));
vi.mock("@/components/VendorDirectory", () => ({ default: () => null }));
vi.mock("@/components/MetroMap", () => ({ default: () => null }));

vi.mock("@/lib/store/authStore", () => ({
  useAuthStore: (sel: (s: { activeUser: { name: string } }) => unknown) =>
    sel({ activeUser: { name: "Jane Buyer" } }),
}));

// Deals + tasks hooks return canned data; patchTaskStatus is the spy under test.
const mockRefreshTasks = vi.fn();
let mockTasks: Task[] = [];
vi.mock("@/hooks/useMyDeals", () => ({
  useMyDeals: () => ({ deals: [makeDeal()], loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock("@/hooks/useTasks", () => ({
  useTasks: () => ({ tasks: mockTasks, loading: false, refresh: mockRefreshTasks }),
  patchTaskStatus: vi.fn(),
}));
// Messages/Documents tabs aren't exercised here but the module is imported.
vi.mock("@/hooks/useMessages", () => ({
  useMessages: () => ({ messages: [], loading: false, refresh: vi.fn() }),
  postMessage: vi.fn(),
}));
// Documents hook: the upload tests spy on the presigned-flow functions.
vi.mock("@/hooks/useDocuments", () => ({
  useDocuments: () => ({ docs: [], loading: false, error: null, refresh: vi.fn() }),
  getDownloadUrl: vi.fn(),
  requestUploadUrl: vi.fn(),
  confirmUpload: vi.fn(),
}));

import BuyerView from "@/components/pages/buyer/BuyerView";
import { patchTaskStatus } from "@/hooks/useTasks";
import { requestUploadUrl, confirmUpload } from "@/hooks/useDocuments";

const mockPatch = patchTaskStatus as Mock;
const mockRequestUploadUrl = requestUploadUrl as Mock;
const mockConfirmUpload = confirmUpload as Mock;

const DEAL_ID = "5f0f6f6a-9b1c-4f6e-8a2d-3c4b5a697e01";
const TASK_ID = "a1b2c3d4-0000-4f6e-8a2d-3c4b5a697e22";

function makeDeal(): MyDeal {
  return {
    id: DEAL_ID,
    type: "buy",
    clientName: "Jane Buyer",
    clientId: "",
    agentId: "agent-1",
    stage: "offer_active", // OfferActiveCard is pure — no extra data hooks
    health: "green",
    priority: "medium",
    property: { address: "123 Main St", city: "Birmingham", state: "AL", zip: "35203", price: 350000 },
    timeline: { createdAt: "2026-05-01T00:00:00Z", daysInStage: 2 },
    flags: [],
    status: "active",
    estimatedCommission: 10500,
    openTaskCount: 1,
    overdueTaskCount: 0,
    agentName: "Sarah Johnson",
    agentEmail: "sarah@realtourflow.com",
    agentPhone: null,
  } as MyDeal;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    dealId: DEAL_ID,
    title: "Send your bank statements",
    assignedTo: "buyer",
    assignedToId: "buyer-1",
    status: "pending",
    priority: "medium",
    source: "manual",
    stageContext: "offer_active",
    actionType: "confirm",
    ...overrides,
  };
}

/** Expand the task row, then click the "Yes, I'm done" confirm button. */
function confirmTask() {
  fireEvent.click(screen.getByText("Send your bank statements"));
  fireEvent.click(screen.getByText(/Yes, I.?m done/));
}

beforeEach(() => {
  mockPatch.mockReset();
  mockRefreshTasks.mockReset();
  mockRequestUploadUrl.mockReset();
  mockConfirmUpload.mockReset();
  mockTasks = [makeTask()];
});

describe("Buyer portal task completion", () => {
  it("calls patchTaskStatus(taskId, 'completed') exactly once when a task is confirmed", async () => {
    mockPatch.mockResolvedValue(undefined);
    render(<BuyerView />);

    confirmTask();

    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1));
    expect(mockPatch).toHaveBeenCalledWith(TASK_ID, "completed");
  });

  it("refetches tasks after a successful completion so the server is the source of truth", async () => {
    mockPatch.mockResolvedValue(undefined);
    render(<BuyerView />);

    confirmTask();

    await waitFor(() => expect(mockRefreshTasks).toHaveBeenCalled());
  });

  it("optimistically checks the task off immediately on click", () => {
    mockPatch.mockReturnValue(new Promise(() => {})); // never resolves — stays in-flight
    render(<BuyerView />);

    confirmTask();

    // The optimistic update removes the open task from the list right away.
    expect(screen.queryByText("Send your bank statements")).toBeNull();
    expect(screen.getByText(/All caught up/)).toBeTruthy();
  });

  it("rolls the optimistic check back AND shows an error when patchTaskStatus rejects", async () => {
    mockPatch.mockRejectedValue(new Error("500 — boom"));
    render(<BuyerView />);

    confirmTask();

    // Error surfaced to the user…
    await screen.findByText(/couldn[’']t|could not|try again|failed/i);
    // …and the task is back in the open list (rollback), not silently "done".
    expect(screen.getByText("Send your bank statements")).toBeTruthy();
  });
});

describe("Buyer portal document upload (upload task)", () => {
  const UPLOAD_URL = "https://s3.example.com/put?sig=abc";
  const S3_KEY = "deals/x/uploads/letter.pdf";

  function makeFile() {
    return new File(["hello"], "preapproval.pdf", { type: "application/pdf" });
  }

  /** Expand an upload task and return its hidden <input type=file>. */
  function openUploadInput(container: HTMLElement): HTMLInputElement {
    fireEvent.click(screen.getByText("Upload your pre-approval letter"));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    return input;
  }

  beforeEach(() => {
    mockTasks = [makeTask({ title: "Upload your pre-approval letter", actionType: "upload" })];
  });

  it("routes the file through the real presigned flow (requestUploadUrl → PUT → confirmUpload)", async () => {
    mockRequestUploadUrl.mockResolvedValue({ upload_url: UPLOAD_URL, s3_key: S3_KEY });
    mockConfirmUpload.mockResolvedValue({ id: "doc-1" });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    const { container } = render(<BuyerView />);
    const input = openUploadInput(container);
    fireEvent.change(input, { target: { files: [makeFile()] } });

    await waitFor(() => expect(mockConfirmUpload).toHaveBeenCalledTimes(1));
    expect(mockRequestUploadUrl).toHaveBeenCalledWith(DEAL_ID, "preapproval.pdf", "application/pdf");
    // The S3 PUT used the presigned URL the API handed back.
    const putUrl = fetchSpy.mock.calls[0]?.[0];
    expect(putUrl).toBe(UPLOAD_URL);
    expect(mockConfirmUpload).toHaveBeenCalledWith(
      DEAL_ID, "preapproval.pdf", S3_KEY, "application/pdf", expect.any(Number),
    );
    // Real success state, not a fake spinner.
    expect(await screen.findByText(/uploaded successfully/i)).toBeTruthy();

    fetchSpy.mockRestore();
  });

  it("shows an error — never a fake 'uploaded' state — when the upload fails", async () => {
    mockRequestUploadUrl.mockRejectedValue(new Error("no presigned url"));

    const { container } = render(<BuyerView />);
    const input = openUploadInput(container);
    fireEvent.change(input, { target: { files: [makeFile()] } });

    await screen.findByText(/upload failed/i);
    expect(screen.queryByText(/uploaded successfully/i)).toBeNull();
    expect(mockConfirmUpload).not.toHaveBeenCalled();
  });
});
