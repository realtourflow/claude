// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PropertyInsights from "@/components/deal/PropertyInsights";
import type { TrackedProperty, PhotoAnalysis } from "@/hooks/useProperties";
import {
  usePropertyComps,
  useAnalyzePhotos,
  type CompsResponse,
} from "@/hooks/usePropertyInsights";

vi.mock("@/hooks/usePropertyInsights", () => ({
  usePropertyComps: vi.fn(),
  useAnalyzePhotos: vi.fn(),
}));

const compsRun = vi.fn();
const photosRun = vi.fn();

function mockComps(over: Partial<ReturnType<typeof usePropertyComps>> = {}) {
  vi.mocked(usePropertyComps).mockReturnValue({
    run: compsRun,
    data: null,
    loading: false,
    error: "",
    ran: false,
    ...over,
  });
}
function mockPhotos(over: Partial<ReturnType<typeof useAnalyzePhotos>> = {}) {
  vi.mocked(useAnalyzePhotos).mockReturnValue({
    run: photosRun,
    data: null,
    loading: false,
    error: "",
    ...over,
  });
}

function makeProp(over: Partial<TrackedProperty> = {}): TrackedProperty {
  return {
    id: "prop-1",
    dealId: "deal-1",
    address: "500 Subject Ln",
    city: "Hoover",
    state: "AL",
    price: 240000,
    beds: 3,
    baths: 2,
    sqft: 2000,
    thumbnailUrl: "https://t/x.jpg",
    sourceUrl: "",
    status: "interested",
    addedBy: "agent",
    ...over,
  };
}

const RANGE: CompsResponse = {
  range: { low: 220000, high: 260000 },
  basis: "price_per_sqft",
  median_price_per_sqft: 120,
  comps: [],
  comp_count: 5,
  max_comps: 10,
  tier_used: "same city, sold 6mo, beds ±1, sqft ±20%",
  widened: false,
  outliers_removed: 0,
  reason: null,
  disclaimer: "Estimated from recent comparable sales. Not an appraisal.",
};

const ANALYSIS: PhotoAnalysis = {
  condition: "good",
  features: ["hardwood floors", "granite counters"],
  flags: ["dated bathroom"],
  summary: "Well-kept 3BR; guest bath dated.",
  photos_analyzed: 4,
  model: "claude-opus-4-8",
  analyzed_at: "2026-07-24T00:00:00Z",
  disclaimer: "AI-generated from listing photos. Not a home inspection.",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockComps();
  mockPhotos();
});

describe("PropertyInsights — comps", () => {
  it("offers a Comp range button and triggers the run on click", () => {
    render(<PropertyInsights prop={makeProp()} />);
    const btn = screen.getByRole("button", { name: /comp range/i });
    fireEvent.click(btn);
    expect(compsRun).toHaveBeenCalledTimes(1);
  });

  it("renders the low–high range, comp context, and disclaimer — no single suggested number", () => {
    mockComps({ data: RANGE, ran: true });
    render(<PropertyInsights prop={makeProp()} />);
    expect(screen.getByText("$220,000 – $260,000")).toBeInTheDocument();
    expect(screen.getByText(/5 sold comps/i)).toBeInTheDocument();
    expect(screen.getByText(/not an appraisal/i)).toBeInTheDocument();
    // Range-only decision: the midpoint ($240,000) must not be surfaced.
    expect(screen.queryByText(/\$240,000/)).not.toBeInTheDocument();
    expect(screen.queryByText(/suggested/i)).not.toBeInTheDocument();
  });

  it("shows offer guidance when the buyer has requested an offer", () => {
    mockComps({ data: RANGE, ran: true });
    render(<PropertyInsights prop={makeProp({ offerRequested: true })} />);
    expect(screen.getByText(/guidance for the buyer's offer/i)).toBeInTheDocument();
  });

  it("does not show offer guidance when no offer was requested", () => {
    mockComps({ data: RANGE, ran: true });
    render(<PropertyInsights prop={makeProp({ offerRequested: false })} />);
    expect(screen.queryByText(/guidance for the buyer's offer/i)).not.toBeInTheDocument();
  });

  it("reports no comps / insufficient comps instead of a fake range", () => {
    mockComps({ data: { ...RANGE, range: null, comp_count: 0, reason: "no_comps" }, ran: true });
    const { rerender } = render(<PropertyInsights prop={makeProp()} />);
    expect(screen.getByText(/no comparable sales found/i)).toBeInTheDocument();

    mockComps({
      data: { ...RANGE, range: null, comp_count: 2, reason: "insufficient_comps" },
      ran: true,
    });
    rerender(<PropertyInsights prop={makeProp()} />);
    expect(screen.getByText(/not enough for a range/i)).toBeInTheDocument();
  });

  it("surfaces the connect-MLS hint on a 503", () => {
    mockComps({ error: "Connect MLS in Settings to pull comps." });
    render(<PropertyInsights prop={makeProp()} />);
    expect(screen.getByText(/connect mls in settings/i)).toBeInTheDocument();
  });

  it("shows a spinner label while comps load", () => {
    mockComps({ loading: true });
    render(<PropertyInsights prop={makeProp()} />);
    expect(screen.getByText(/pulling comps/i)).toBeInTheDocument();
  });
});

describe("PropertyInsights — photo tags", () => {
  it("offers an Analyze photos button and triggers the run when there is no stored analysis", () => {
    render(<PropertyInsights prop={makeProp()} />);
    fireEvent.click(screen.getByRole("button", { name: /analyze photos/i }));
    expect(photosRun).toHaveBeenCalledTimes(1);
  });

  it("renders stored photo tags: condition, features, flags, summary, disclaimer", () => {
    render(<PropertyInsights prop={makeProp({ photoAnalysis: ANALYSIS })} />);
    expect(screen.getByText("good")).toBeInTheDocument();
    expect(screen.getByText("hardwood floors")).toBeInTheDocument();
    expect(screen.getByText("granite counters")).toBeInTheDocument();
    expect(screen.getByText("dated bathroom")).toBeInTheDocument();
    expect(screen.getByText(/well-kept 3br/i)).toBeInTheDocument();
    expect(screen.getByText(/4 photos analyzed/i)).toBeInTheDocument();
    expect(screen.getByText(/not a home inspection/i)).toBeInTheDocument();
    // Re-analyze affordance replaces the initial button once tags exist.
    expect(screen.getByRole("button", { name: /re-analyze photos/i })).toBeInTheDocument();
  });

  it("prefers a just-returned analysis over stale stored tags", () => {
    mockPhotos({ data: { ...ANALYSIS, condition: "poor", summary: "fresh result" } });
    render(<PropertyInsights prop={makeProp({ photoAnalysis: ANALYSIS })} />);
    expect(screen.getByText("poor")).toBeInTheDocument();
    expect(screen.getByText(/fresh result/i)).toBeInTheDocument();
  });

  it("shows the analyzing spinner and an error on failure", () => {
    mockPhotos({ loading: true });
    const { rerender } = render(<PropertyInsights prop={makeProp()} />);
    expect(screen.getByText(/analyzing photos/i)).toBeInTheDocument();

    mockPhotos({ error: "photo analysis is not configured" });
    rerender(<PropertyInsights prop={makeProp()} />);
    expect(screen.getByText(/not configured/i)).toBeInTheDocument();
  });
});
