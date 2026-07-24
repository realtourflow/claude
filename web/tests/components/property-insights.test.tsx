// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PropertyInsights from "@/components/deal/PropertyInsights";
import type { TrackedProperty } from "@/hooks/useProperties";
import { usePropertyComps, type CompsResponse } from "@/hooks/usePropertyInsights";

vi.mock("@/hooks/usePropertyInsights", () => ({
  usePropertyComps: vi.fn(),
}));

const compsRun = vi.fn();

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

beforeEach(() => {
  vi.clearAllMocks();
  mockComps();
});

describe("PropertyInsights — comp range", () => {
  it("offers a Pull comps button and triggers the run on click", () => {
    render(<PropertyInsights prop={makeProp()} />);
    fireEvent.click(screen.getByRole("button", { name: /pull comps/i }));
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
