// @vitest-environment happy-dom
/**
 * Issue #107 — Buyer and Seller portals spin indefinitely when the API
 * call for /me/deals fails. After the fix both portals must show an error
 * message and a "Try again" retry button instead of an infinite spinner.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Shared mocks ─────────────────────────────────────────────────────────────

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
  useTasks: () => ({ tasks: [], loading: false, error: null }),
}));

vi.mock("@/hooks/useShowingAvailability", () => ({
  useShowingAvailability: () => ({ slots: [] }),
  DAYS_OF_WEEK: [],
}));

vi.mock("@/hooks/useMessages", () => ({
  useMessages: () => ({ messages: [], loading: false, error: null, refresh: vi.fn() }),
  postMessage: vi.fn(),
}));

vi.mock("@/hooks/useProperties", () => ({
  useProperties: () => ({ properties: [], loading: false }),
}));

vi.mock("@/hooks/useMLS", () => ({
  useMLSListings: () => ({ listings: [], loading: false, error: null, search: vi.fn() }),
}));

vi.mock("@/hooks/useAgentDocs", () => ({
  useAgentDocTemplatesForDeal: () => ({ templates: [], loading: false, getDownloadUrl: vi.fn() }),
  DOC_TYPE_LABELS: {},
}));

vi.mock("@/hooks/useDocuments", () => ({
  useDocuments: () => ({ docs: [], loading: false, error: null }),
  getDownloadUrl: vi.fn(),
}));

vi.mock("@/lib/store/agentDocStore", () => ({
  useAgentDocStore: () => ({ templates: [] }),
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
import SellerView from "@/components/pages/seller/SellerView";

const ERROR_RETURN = {
  deals: [],
  loading: false,
  error: "Request timed out",
  refresh: vi.fn(),
};

// BuyerView calls useQueryClient (to invalidate the documents query after a
// task upload), so it must render under a QueryClientProvider.
function renderView(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── BuyerView ────────────────────────────────────────────────────────────────

describe("BuyerView — error state (#107)", () => {
  it("renders an error message when useMyDeals returns an error", () => {
    vi.mocked(useMyDeals).mockReturnValue(ERROR_RETURN);

    renderView(<BuyerView />);

    expect(screen.getByText(/unable to load your deal/i)).toBeInTheDocument();
  });

  it("renders a retry button that calls refresh", () => {
    const mockRefresh = vi.fn();
    vi.mocked(useMyDeals).mockReturnValue({ ...ERROR_RETURN, refresh: mockRefresh });

    renderView(<BuyerView />);

    const retryBtn = screen.getByRole("button", { name: /try again/i });
    expect(retryBtn).toBeInTheDocument();

    fireEvent.click(retryBtn);
    expect(mockRefresh).toHaveBeenCalledOnce();
  });
});

// ─── SellerView ───────────────────────────────────────────────────────────────

describe("SellerView — error state (#107)", () => {
  it("renders an error message when useMyDeals returns an error", () => {
    vi.mocked(useMyDeals).mockReturnValue(ERROR_RETURN);

    renderView(<SellerView />);

    expect(screen.getByText(/unable to load your deal/i)).toBeInTheDocument();
  });

  it("renders a retry button that calls refresh", () => {
    const mockRefresh = vi.fn();
    vi.mocked(useMyDeals).mockReturnValue({ ...ERROR_RETURN, refresh: mockRefresh });

    renderView(<SellerView />);

    const retryBtn = screen.getByRole("button", { name: /try again/i });
    expect(retryBtn).toBeInTheDocument();

    fireEvent.click(retryBtn);
    expect(mockRefresh).toHaveBeenCalledOnce();
  });
});
