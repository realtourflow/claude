// @vitest-environment happy-dom
/**
 * Issue #269 — the buyer portal shipped mock-era UI that either lied to buyers or
 * could never render:
 *   - ClosingCard told every closing-day buyer to "Call Sarah" — a person who does
 *     not exist. The real agent's name lives on the deal (deal.agentName).
 *   - FallenThroughCard hard-coded a fake phone (tel:+12055550100) and a fake email
 *     (mailto:sarah@realtourflow.com). It could never render — deal.status is always
 *     'active' — so the whole isFallenThrough branch was dead mock UI.
 *   - The closing countdown ("N days to close") was gated on timeline.daysToClose,
 *     which nothing ever set, so it never rendered.
 *
 * After the fix:
 *   - the closing card names the real agent (never "Sarah"),
 *   - no rendered buyer-portal output contains the fake phone/email at any stage, and
 *   - apiDealToFrontend derives daysToClose from the closing date so the countdown is
 *     driven by real data.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MyDeal } from "@/hooks/useMyDeals";
import type { DealStage } from "@/lib/types";
import { apiDealToFrontend, type ApiDeal } from "@/hooks/useDeals";

// ─── Shared mocks (mirror BuyerView.test.tsx) ─────────────────────────────────

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

vi.mock("@/hooks/useNotifications", () => ({
  useNotifications: () => ({
    notifications: [],
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/components/portal/PortalDealDocuments", () => ({ default: () => null }));
vi.mock("@/components/ClientNotifications", () => ({ default: () => null }));
vi.mock("@/components/MetroMap", () => ({ default: () => null }));
vi.mock("@/components/VendorDirectory", () => ({ default: () => null }));

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

const BASE_DEAL: MyDeal = {
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
  agentName: "Jordan Rivera",
  agentEmail: "jordan@example.com",
  agentPhone: null,
};

const ALL_STAGES: DealStage[] = [
  "intake",
  "active_search",
  "offer_active",
  "under_contract",
  "pre_close",
  "closing",
  "post_close",
];

function mockDeal(overrides: Partial<MyDeal>) {
  vi.mocked(useMyDeals).mockReturnValue({
    deals: [{ ...BASE_DEAL, ...overrides }],
    loading: false,
    error: null,
    refresh: vi.fn(),
  });
}

function renderView(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Case 1: closing card names the real agent, never "Sarah" ─────────────────

describe("BuyerView closing card (#269)", () => {
  it("names the real agent on closing day and never mentions 'Sarah'", () => {
    mockDeal({ stage: "closing", agentName: "Jordan Rivera" });
    const { container } = renderView(<BuyerView />);

    expect(container.textContent).toContain("Call Jordan Rivera before you leave");
    expect(container.textContent ?? "").not.toMatch(/Sarah/i);
  });
});

// ─── Case 2: no fake mock-era contacts render at any stage ────────────────────

describe("BuyerView has no mock-era fake contacts at any stage (#269)", () => {
  for (const stage of ALL_STAGES) {
    it(`stage '${stage}' renders no fake phone, email, or "Sarah"`, () => {
      mockDeal({ stage });
      const { container } = renderView(<BuyerView />);
      const html = container.innerHTML;

      // Fake email from the deleted FallenThroughCard.
      expect(html).not.toContain("sarah@realtourflow.com");
      // Reserved-fiction (+1 205 555-0100) number from the deleted FallenThroughCard.
      // NB: the real Mountain Mortgage line (205-401-9076) is legitimate and stays.
      expect(html).not.toContain("2055550100");
      expect(container.textContent ?? "").not.toMatch(/Sarah/i);
    });
  }
});

// ─── Case 3: countdown is driven by real closing-date data ────────────────────

describe("closing countdown is derived from the closing date (#269)", () => {
  it("apiDealToFrontend computes daysToClose from an ARIVE closing date ~10 days out", () => {
    const tenDaysOut = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const apiDeal: ApiDeal = {
      id: "d1",
      agent_id: "a1",
      type: "buy",
      stage: "under_contract",
      health: "green",
      title: "Test Deal",
      address: "1 Main St",
      price: "300000",
      arive_linked: true,
      arive_key_dates: { estimatedFundingDate: tenDaysOut },
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    const deal = apiDealToFrontend(apiDeal);
    expect(deal.timeline.closingDate).toBe(tenDaysOut);
    expect(deal.timeline.daysToClose).toBe(10);
  });

  it("apiDealToFrontend leaves daysToClose undefined with no closing date", () => {
    const apiDeal: ApiDeal = {
      id: "d2",
      agent_id: "a1",
      type: "buy",
      stage: "active_search",
      health: "green",
      title: "Test Deal",
      address: null,
      price: null,
      arive_linked: false,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    const deal = apiDealToFrontend(apiDeal);
    expect(deal.timeline.daysToClose).toBeUndefined();
  });

  it("renders the countdown when daysToClose is present", () => {
    mockDeal({
      stage: "under_contract",
      timeline: { createdAt: "2026-01-01T00:00:00Z", daysInStage: 3, closingDate: "2026-03-01", daysToClose: 10 },
    });
    const { container } = renderView(<BuyerView />);
    expect(container.textContent).toMatch(/10\s*days to close/);
  });

  it("hides the countdown when daysToClose is absent", () => {
    mockDeal({
      stage: "under_contract",
      timeline: { createdAt: "2026-01-01T00:00:00Z", daysInStage: 3 },
    });
    const { container } = renderView(<BuyerView />);
    expect(container.textContent ?? "").not.toContain("days to close");
  });
});
