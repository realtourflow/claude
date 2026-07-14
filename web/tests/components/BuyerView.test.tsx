// @vitest-environment happy-dom
/**
 * Issue #294 — the buyer portal hard-coded the Messages tab badge to
 * `msgCount={0}`, so a buyer never saw an unread-message count. Unread-for-a-deal
 * is derived client-side from the notifications the bell already loads:
 *   type === 'new_message' && dealId === deal.id && !read
 *
 * After the fix:
 *   - the Messages tab badge reflects the real unread count for THIS deal, and
 *   - opening the Messages tab marks exactly those notifications read
 *     (other deals / other types are untouched).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MyDeal } from "@/hooks/useMyDeals";
import type { AppNotification } from "@/hooks/useNotifications";

// ─── Shared mocks (mirror buyer-fastpass-price.test.tsx) ──────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

vi.mock("@/lib/store/authStore", () => ({
  useAuthStore: (selector: (s: { activeUser: null }) => unknown) =>
    selector({ activeUser: null }),
}));

vi.mock("@/hooks/useMyDeals", () => ({
  useMyDeals: vi.fn(),
}));

vi.mock("@/hooks/useTasks", () => ({
  useTasks: () => ({ tasks: [], loading: false, error: null, refresh: vi.fn() }),
}));

vi.mock("@/hooks/useTaskCompletion", () => ({
  useTaskCompletion: () => ({
    completedIds: new Set<string>(),
    error: null,
    clearError: vi.fn(),
    complete: vi.fn(),
  }),
}));

vi.mock("@/hooks/useMessages", () => ({
  useMessages: () => ({ messages: [], loading: false, error: null, refresh: vi.fn() }),
  postMessage: vi.fn(),
}));

vi.mock("@/hooks/useProperties", () => ({
  useProperties: () => ({
    properties: [],
    loading: false,
    refresh: vi.fn(),
    addProperty: vi.fn().mockResolvedValue(undefined),
    removeProperty: vi.fn().mockResolvedValue(undefined),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    updateBuyerNote: vi.fn().mockResolvedValue(undefined),
    updateAgentNote: vi.fn().mockResolvedValue(undefined),
    setOfferRequested: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/hooks/useMLS", () => ({
  useMLSListings: () => ({ listings: [], loading: false, error: null, search: vi.fn() }),
}));

vi.mock("@/hooks/useDocuments", () => ({
  useDocuments: () => ({ docs: [], loading: false, error: null }),
  getDownloadUrl: vi.fn(),
  getSigningUrl: vi.fn(),
  requestUploadUrl: vi.fn(),
  confirmUpload: vi.fn(),
}));

// The notifications source under test — each case controls what the bell returns
// and inspects the per-notification markRead spy.
let mockNotifications: AppNotification[] = [];
const mockMarkRead = vi.fn();
vi.mock("@/hooks/useNotifications", () => ({
  useNotifications: () => ({
    notifications: mockNotifications,
    markRead: mockMarkRead,
    markAllRead: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/components/portal/PortalDealDocuments", () => ({
  default: () => null,
}));

vi.mock("@/components/ClientNotifications", () => ({
  default: () => null,
}));

vi.mock("@/components/MetroMap", () => ({
  default: () => null,
}));

vi.mock("@/components/VendorDirectory", () => ({
  default: () => null,
}));

vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, statusText: string) { super(statusText); this.status = status; this.body = null; }
  },
  setTokenGetter: vi.fn(),
}));

import { useMyDeals } from "@/hooks/useMyDeals";
import BuyerView from "@/components/pages/buyer/BuyerView";

const DEAL_ID = "deal-1";

// A non-intake, non-post_close, non-fallen-through buyer deal — the state in
// which BuyerView renders the <TabBar /> with the Messages badge.
const DEAL: MyDeal = {
  id: DEAL_ID,
  type: "buy",
  clientName: "Betty Buyer",
  clientId: "u-buyer",
  agentId: "u-agent",
  stage: "active_search",
  health: "green",
  priority: "medium",
  property: { address: "123 Oak St", city: "Hoover", state: "AL", zip: "35226", price: 300000 },
  timeline: { createdAt: "2026-01-01T00:00:00Z", daysInStage: 3 },
  flags: [],
  status: "active",
  estimatedCommission: 0,
  preApproved: true,
  baaSigned: true,
  agentName: "Alice Agent",
  agentEmail: "agent@example.com",
  agentPhone: null,
};

function makeNotif(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: "notif-1",
    title: "New message from your agent",
    body: "Take a look when you get a chance.",
    type: "new_message",
    dealId: DEAL_ID,
    read: false,
    createdAt: "just now",
    ...overrides,
  };
}

function renderView(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockNotifications = [];
  vi.mocked(useMyDeals).mockReturnValue({
    deals: [DEAL],
    loading: false,
    error: null,
    refresh: vi.fn(),
  });
});

describe("BuyerView — Messages tab unread badge (#294)", () => {
  it("shows the real unread new_message count for this deal on the Messages tab", () => {
    mockNotifications = [makeNotif()]; // one unread new_message for this deal
    renderView(<BuyerView />);

    const messagesTab = screen.getByRole("button", { name: /messages/i });
    expect(messagesTab).toHaveTextContent("1");
  });

  it("does not badge the Messages tab when there are no unread messages for this deal", () => {
    mockNotifications = [
      makeNotif({ id: "read-msg", read: true }),                       // already read
      makeNotif({ id: "other-deal", dealId: "some-other-deal" }),      // different deal
      makeNotif({ id: "other-type", type: "task_assigned" }),          // not a message
    ];
    renderView(<BuyerView />);

    const messagesTab = screen.getByRole("button", { name: /messages/i });
    expect(messagesTab).not.toHaveTextContent("1");
  });

  it("marks only this deal's unread new_message notifications read when the Messages tab opens", () => {
    mockNotifications = [
      makeNotif({ id: "this-msg", type: "new_message", dealId: DEAL_ID, read: false }),
      makeNotif({ id: "other-deal-msg", type: "new_message", dealId: "other-deal", read: false }),
      makeNotif({ id: "other-type", type: "task_assigned", dealId: DEAL_ID, read: false }),
      makeNotif({ id: "already-read", type: "new_message", dealId: DEAL_ID, read: true }),
    ];
    renderView(<BuyerView />);

    fireEvent.click(screen.getByRole("button", { name: /messages/i }));

    expect(mockMarkRead).toHaveBeenCalledWith("this-msg");
    expect(mockMarkRead).not.toHaveBeenCalledWith("other-deal-msg");
    expect(mockMarkRead).not.toHaveBeenCalledWith("other-type");
    expect(mockMarkRead).not.toHaveBeenCalledWith("already-read");
    expect(mockMarkRead).toHaveBeenCalledTimes(1);
  });
});
