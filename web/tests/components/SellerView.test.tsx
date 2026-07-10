// @vitest-environment happy-dom
/**
 * Regression test for #182 — sellers at 'Listed & Active' (offer_active) were
 * shown three hard-coded fake offers ('The Patterson Family $392,000',
 * 'Marcus & Diane Liu $387,500', 'Kevin Okafor $395,000 Cash — Best Offer')
 * via a mock <OfferComparison>, plus fabricated showing stats ('Showings: 7',
 * 'Online Views: 142') and a made-up feedback quote. The Accept/Counter/Decline
 * buttons had no onClick.
 *
 * The seller must only ever see real offers (from useOffers) or an honest
 * empty state, and no invented showing/view data.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MyDeal } from "@/hooks/useMyDeals";
import type { Offer } from "@/hooks/useOffers";

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/ClientNotifications", () => ({ default: () => null }));
vi.mock("@/components/VendorDirectory", () => ({ default: () => null }));
vi.mock("@/components/portal/PortalDealDocuments", () => ({ default: () => null }));

vi.mock("@/lib/store/authStore", () => ({
  useAuthStore: (sel: (s: { activeUser: { name: string } }) => unknown) =>
    sel({ activeUser: { name: "Sam Seller" } }),
}));
vi.mock("@/lib/store/dealStageStore", () => ({
  useDealStageStore: () => ({ buyerStatusByDeal: {} }),
}));

vi.mock("@/hooks/useMyDeals", () => ({
  useMyDeals: () => ({ deals: [makeDeal()], loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock("@/hooks/useTasks", () => ({
  useTasks: () => ({ tasks: [], loading: false, refresh: vi.fn() }),
  patchTaskStatus: vi.fn(),
}));
vi.mock("@/hooks/useMessages", () => ({
  useMessages: () => ({ messages: [], loading: false, refresh: vi.fn() }),
  postMessage: vi.fn(),
}));
// Non-empty availability so the auto showing-availability modal stays closed.
vi.mock("@/hooks/useShowingAvailability", () => ({
  DAYS_OF_WEEK: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  useShowingAvailability: () => ({
    slots: [{ day: "Mon", from: "09:00", to: "18:00" }],
    loading: false,
    saveSlots: vi.fn(),
    refresh: vi.fn(),
  }),
}));
vi.mock("@/hooks/useNetSheet", () => ({
  useNetSheet: () => ({ sheet: null, loading: false, notReady: true, refresh: vi.fn() }),
  recalcLines: () => [],
  calcNetProceeds: () => 0,
}));

// The offers source under test — each case controls what the "server" returns.
let mockOffers: Offer[] = [];
vi.mock("@/hooks/useOffers", () => ({
  useOffers: () => ({
    offers: mockOffers,
    loading: false,
    refresh: vi.fn(),
    addOffer: vi.fn(),
    removeOffer: vi.fn(),
  }),
}));

import SellerView from "@/components/pages/seller/SellerView";

const DEAL_ID = "5f0f6f6a-9b1c-4f6e-8a2d-3c4b5a697e01";

function makeDeal(): MyDeal {
  return {
    id: DEAL_ID,
    type: "sell",
    clientName: "Sam Seller",
    clientId: "",
    agentId: "agent-1",
    stage: "offer_active", // 'Listed & Active' — where the fake offers appeared
    health: "green",
    priority: "medium",
    property: { address: "742 Evergreen Ter", city: "Birmingham", state: "AL", zip: "35203", price: 390000 },
    timeline: { createdAt: "2026-05-01T00:00:00Z", daysInStage: 12 },
    flags: [],
    status: "active",
    estimatedCommission: 11700,
    openTaskCount: 0,
    overdueTaskCount: 0,
    agentName: "Sarah Johnson",
    agentEmail: "sarah@realtourflow.com",
    agentPhone: null,
  } as MyDeal;
}

function makeOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    dealId: DEAL_ID,
    buyerName: "Jordan Rivera",
    offerPrice: 401000,
    closeDate: "2026-08-14",
    contingencies: ["Inspection"],
    agentNotes: "Strong pre-approval, flexible on possession.",
    submittedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function renderSeller(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  sessionStorage.clear();
  mockOffers = [];
});

describe("SellerView at offer_active — offers are real, never fabricated (#182)", () => {
  it("shows NO offers and an honest empty state when the deal has zero real offers", () => {
    mockOffers = [];
    renderSeller(<SellerView />);

    // None of the hard-coded fake offers may render.
    expect(screen.queryByText(/Patterson/)).toBeNull();
    expect(screen.queryByText(/Marcus & Diane Liu/)).toBeNull();
    expect(screen.queryByText(/Kevin Okafor/)).toBeNull();
    expect(screen.queryByText(/392,000/)).toBeNull();
    expect(screen.queryByText(/387,500/)).toBeNull();
    expect(screen.queryByText(/395,000/)).toBeNull();
    expect(screen.queryByText(/Best Offer/)).toBeNull();
    expect(screen.queryByText(/3 offers/)).toBeNull();

    // No dead action buttons anywhere.
    expect(screen.queryByText("Accept")).toBeNull();
    expect(screen.queryByText("Counter")).toBeNull();
    expect(screen.queryByText("Decline")).toBeNull();

    // Honest empty state instead.
    expect(screen.getByText(/No offers yet/i)).toBeTruthy();
  });

  it("renders the real offers from useOffers when they exist", () => {
    mockOffers = [
      makeOffer(),
      makeOffer({
        id: "66666666-7777-4888-9999-aaaaaaaaaaaa",
        buyerName: "Priya Natarajan",
        offerPrice: 385000,
        contingencies: [],
        agentNotes: "",
      }),
    ];
    renderSeller(<SellerView />);

    expect(screen.getByText(/Jordan Rivera/)).toBeTruthy();
    expect(screen.getByText(/\$401,000/)).toBeTruthy();
    expect(screen.getByText(/Priya Natarajan/)).toBeTruthy();
    expect(screen.getByText(/\$385,000/)).toBeTruthy();
    expect(screen.getByText(/Offers Received \(2\)/i)).toBeTruthy();

    // Still no fake offers mixed in, and no inert Accept/Counter/Decline buttons.
    expect(screen.queryByText(/Patterson/)).toBeNull();
    expect(screen.queryByText("Accept")).toBeNull();
    expect(screen.queryByText("Counter")).toBeNull();
    expect(screen.queryByText("Decline")).toBeNull();
  });

  it("shows no fabricated showing/view stats or feedback — only the real days-listed count", () => {
    renderSeller(<SellerView />);

    // The invented numbers and quote must be gone.
    expect(screen.queryByText("Showings")).toBeNull();
    expect(screen.queryByText("7")).toBeNull();
    expect(screen.queryByText("Online Views")).toBeNull();
    expect(screen.queryByText("142")).toBeNull();
    expect(screen.queryByText(/Great layout, loved the kitchen/)).toBeNull();
    expect(screen.queryByText(/Latest showing feedback/i)).toBeNull();

    // The real stat (derived from deal.timeline.daysInStage) stays.
    expect(screen.getByText("Days Listed")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
  });
});
