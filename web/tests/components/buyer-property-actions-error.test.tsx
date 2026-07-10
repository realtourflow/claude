// @vitest-environment happy-dom
/**
 * Issue #168 — the buyer home-search card (ActiveSearchCard) used to swallow
 * every failed property write with `.catch(() => {})` and report fake success
 * ("Your agent has been notified", chip flips to Added) while nothing
 * persisted. After the fix, failures must surface a real error and success
 * states must only render after the API call resolves.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MyDeal } from "@/hooks/useMyDeals";
import type { TrackedProperty } from "@/hooks/useProperties";

// ─── Shared mocks (mirrors buyer-portal-error.test.tsx) ───────────────────────

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
  useProperties: vi.fn(),
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
import { useProperties } from "@/hooks/useProperties";
import BuyerView from "@/components/pages/buyer/BuyerView";

const DEAL: MyDeal = {
  id: "deal-1",
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

function makeProp(overrides: Partial<TrackedProperty> = {}): TrackedProperty {
  return {
    id: "p1",
    dealId: "deal-1",
    address: "500 Pine Ave",
    city: "Hoover",
    state: "AL",
    price: 250000,
    beds: 3,
    baths: 2,
    sqft: 1500,
    thumbnailUrl: "",
    sourceUrl: "",
    status: "interested",
    addedBy: "buyer",
    offerRequested: false,
    ...overrides,
  };
}

type UsePropertiesReturn = ReturnType<typeof useProperties>;

function makePropertiesReturn(
  overrides: Partial<UsePropertiesReturn> = {}
): UsePropertiesReturn {
  return {
    properties: [],
    loading: false,
    refresh: vi.fn(),
    addProperty: vi.fn().mockResolvedValue(undefined),
    removeProperty: vi.fn().mockResolvedValue(undefined),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    updateBuyerNote: vi.fn().mockResolvedValue(undefined),
    updateAgentNote: vi.fn().mockResolvedValue(undefined),
    setOfferRequested: vi.fn().mockResolvedValue(undefined),
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
  vi.mocked(useMyDeals).mockReturnValue({
    deals: [DEAL],
    loading: false,
    error: null,
    refresh: vi.fn(),
  });
});

describe("ActiveSearchCard — Make an Offer (#168)", () => {
  it("shows an error (not fake success) when the offer request fails", async () => {
    const setOfferRequested = vi.fn().mockRejectedValue(new Error("404"));
    vi.mocked(useProperties).mockReturnValue(
      makePropertiesReturn({ properties: [makeProp()], setOfferRequested })
    );

    renderView(<BuyerView />);

    fireEvent.click(screen.getByRole("button", { name: /make an offer/i }));

    expect(
      await screen.findByText(/couldn.t send your offer request/i)
    ).toBeInTheDocument();
    expect(setOfferRequested).toHaveBeenCalledWith("p1", true);
    expect(
      screen.queryByText(/your agent has been notified/i)
    ).not.toBeInTheDocument();
  });

  it("shows the confirmation only after the offer request succeeds", async () => {
    const setOfferRequested = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useProperties).mockReturnValue(
      makePropertiesReturn({ properties: [makeProp()], setOfferRequested })
    );

    renderView(<BuyerView />);

    fireEvent.click(screen.getByRole("button", { name: /make an offer/i }));

    expect(
      await screen.findByText(/your agent has been notified/i)
    ).toBeInTheDocument();
  });
});

describe("ActiveSearchCard — add property (#168)", () => {
  it("surfaces a real error when adding a property fails", async () => {
    const addProperty = vi.fn().mockRejectedValue(new Error("404"));
    vi.mocked(useProperties).mockReturnValue(
      makePropertiesReturn({ addProperty })
    );

    renderView(<BuyerView />);

    fireEvent.click(screen.getByRole("button", { name: /add a property/i }));
    fireEvent.change(screen.getByPlaceholderText(/address/i), {
      target: { value: "42 Wallaby Way" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add property" }));

    expect(
      await screen.findByText(/couldn.t add that property/i)
    ).toBeInTheDocument();
    expect(addProperty).toHaveBeenCalled();
  });
});

describe("ActiveSearchCard — remove property (#168)", () => {
  it("hides the remove button on agent-added properties for the buyer", () => {
    vi.mocked(useProperties).mockReturnValue(
      makePropertiesReturn({
        properties: [makeProp({ id: "p-agent", addedBy: "agent" })],
      })
    );

    renderView(<BuyerView />);

    expect(
      screen.queryByRole("button", { name: /remove property/i })
    ).not.toBeInTheDocument();
  });

  it("shows the remove button on buyer-added properties and surfaces failures", async () => {
    const removeProperty = vi.fn().mockRejectedValue(new Error("404"));
    vi.mocked(useProperties).mockReturnValue(
      makePropertiesReturn({ properties: [makeProp()], removeProperty })
    );

    renderView(<BuyerView />);

    fireEvent.click(screen.getByRole("button", { name: /remove property/i }));

    expect(await screen.findByText(/couldn.t update/i)).toBeInTheDocument();
    expect(removeProperty).toHaveBeenCalledWith("p1");
  });
});
