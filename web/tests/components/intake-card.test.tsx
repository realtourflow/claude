// @vitest-environment happy-dom
/**
 * IntakeCard (#175) — read-only display of the persisted buyer/seller
 * onboarding questionnaire (deals.intake). Self-contained: fetches
 * GET /deals/:id/intake itself unless an intake payload is passed as a prop.
 * NOT mounted in DealDetail here — a follow-up DealDetail-owner PR mounts it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, statusText: string) {
      super(statusText);
      this.status = status;
      this.body = null;
    }
  },
  setTokenGetter: vi.fn(),
}));

import { api } from "@/lib/api-client";
import IntakeCard, { type DealIntakePayload } from "@/components/intake/IntakeCard";

const buyerIntake: DealIntakePayload = {
  role: "buyer",
  submitted_at: "2026-07-10T12:00:00.000Z",
  answers: {
    firstTimeBuyer: "yes",
    bedrooms: "3",
    bathrooms: "2",
    areas: "Hoover, Vestavia Hills",
    minBudget: 250000,
    maxBudget: 425000,
    creditScore: "Good (720+)",
    lenderChoice: "mountain",
    trackingAddress: "42 Elm St, Birmingham, AL",
    notes: "",
  },
};

const sellerIntake: DealIntakePayload = {
  role: "seller",
  submitted_at: "2026-07-10T12:00:00.000Z",
  answers: {
    address: "123 Oak Lane, Birmingham, AL 35203",
    desiredListDate: "Within 30 days",
    whatMattersMost: "Speed of sale",
    reasonsForSelling: ["Upsizing", "Relocating"],
    lenderChoice: "fastpass",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("IntakeCard", () => {
  it("renders buyer answers with readable labels (budget, areas, lender choice)", () => {
    render(<IntakeCard dealId="deal-1" intake={buyerIntake} />);

    expect(screen.getByText(/client intake/i)).toBeTruthy();
    // Budget renders as a combined formatted range.
    expect(screen.getByText(/\$250K/)).toBeTruthy();
    expect(screen.getByText(/\$425K/)).toBeTruthy();
    // Areas answer + label surface.
    expect(screen.getByText("Hoover, Vestavia Hills")).toBeTruthy();
    expect(screen.getByText(/areas/i)).toBeTruthy();
    // lenderChoice is visible as a Mountain Mortgage flag.
    expect(screen.getByText(/mountain mortgage/i)).toBeTruthy();
    // Empty answers are skipped entirely (notes: "").
    expect(screen.queryByText(/^notes$/i)).toBeNull();
  });

  it("renders seller answers including the property address and list date", () => {
    render(<IntakeCard dealId="deal-2" intake={sellerIntake} />);

    expect(screen.getByText("123 Oak Lane, Birmingham, AL 35203")).toBeTruthy();
    expect(screen.getByText("Within 30 days")).toBeTruthy();
    expect(screen.getByText("Speed of sale")).toBeTruthy();
    // Multi-select answers join into one readable value.
    expect(screen.getByText("Upsizing, Relocating")).toBeTruthy();
    // Fast Pass interest is visible.
    expect(screen.getByText(/fast pass/i)).toBeTruthy();
  });

  it("fetches the intake by dealId when no payload prop is given", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ intake: buyerIntake });

    render(<IntakeCard dealId="deal-3" />);

    await waitFor(() => {
      expect(screen.getByText("Hoover, Vestavia Hills")).toBeTruthy();
    });
    expect(api.get).toHaveBeenCalledWith("/deals/deal-3/intake");
  });

  it("shows an empty state when the deal has no intake", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ intake: null });

    render(<IntakeCard dealId="deal-4" />);

    await waitFor(() => {
      expect(screen.getByText(/no intake/i)).toBeTruthy();
    });
  });

  it("shows the empty state (not a crash) when the fetch fails", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));

    render(<IntakeCard dealId="deal-5" />);

    await waitFor(() => {
      expect(screen.getByText(/no intake/i)).toBeTruthy();
    });
  });
});
