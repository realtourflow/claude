// @vitest-environment happy-dom
/**
 * Issue #106 — "Create Deal" modal stays stuck in "Creating…" state when the
 * API call fails. After the fix, the error message must appear and the submit
 * button must be re-enabled so the user can retry.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NewDealModal } from "@/components/pages/agent/Pipeline";

vi.mock("@/lib/api-client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, statusText: string, body: unknown) {
      super(`${status} ${statusText}`);
      this.status = status;
      this.body = body;
    }
  },
  setTokenGetter: vi.fn(),
}));

// NewDealModal doesn't use routing, auth, or react-query — no providers needed.
import { api } from "@/lib/api-client";
import { apiDealToFrontend, type ApiDeal } from "@/hooks/useDeals";

const onClose = vi.fn();
const onCreated = vi.fn();

function fillAndSubmit() {
  fireEvent.change(screen.getByPlaceholderText(/e\.g\. jane doe/i), {
    target: { value: "Smith Family" },
  });
  fireEvent.change(screen.getByPlaceholderText("350,000"), {
    target: { value: "450000" },
  });
  fireEvent.submit(document.getElementById("new-deal-form")!);
}

describe("NewDealModal — API failure path (#106)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an error message and re-enables the submit button when the API rejects", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error("Request timed out"));

    render(<NewDealModal onClose={onClose} onCreated={onCreated} />);

    fillAndSubmit();

    // While in-flight the button label changes and is disabled
    expect(screen.getByRole("button", { name: /creating/i })).toBeDisabled();

    // After the API call rejects: error message surfaces and button resets
    await waitFor(() => {
      expect(screen.getByText(/failed to create deal/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /create deal/i })).not.toBeDisabled();
  });

  it("does not call onCreated when the API rejects", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error("Network error"));

    render(<NewDealModal onClose={onClose} onCreated={onCreated} />);

    fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByText(/failed to create deal/i)).toBeInTheDocument();
    });

    expect(onCreated).not.toHaveBeenCalled();
  });
});

describe("NewDealModal — Est. Closing Date is sent to the API (#253)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes the entered closing_date in the create request body", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({} as never);

    render(<NewDealModal onClose={onClose} onCreated={onCreated} />);

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. jane doe/i), {
      target: { value: "Smith Family" },
    });
    fireEvent.change(screen.getByPlaceholderText("350,000"), {
      target: { value: "450000" },
    });
    // The Est. Closing Date input (type=date) — previously dropped on submit.
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-09-30" } });
    fireEvent.submit(document.getElementById("new-deal-form")!);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledTimes(1);
    });
    const [, body] = vi.mocked(api.post).mock.calls[0];
    expect(body).toMatchObject({ closing_date: "2026-09-30" });
  });

  it("sends closing_date null when the field is left blank", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({} as never);

    render(<NewDealModal onClose={onClose} onCreated={onCreated} />);

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. jane doe/i), {
      target: { value: "Smith Family" },
    });
    fireEvent.change(screen.getByPlaceholderText("350,000"), {
      target: { value: "450000" },
    });
    fireEvent.submit(document.getElementById("new-deal-form")!);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledTimes(1);
    });
    const [, body] = vi.mocked(api.post).mock.calls[0];
    expect(body).toMatchObject({ closing_date: null });
  });
});

describe("apiDealToFrontend — closing date precedence (#253)", () => {
  function makeDeal(overrides: Partial<ApiDeal>): ApiDeal {
    return {
      id: "00000000-0000-0000-0000-000000000001",
      agent_id: "00000000-0000-0000-0000-0000000000a1",
      type: "buy",
      stage: "intake",
      health: "green",
      title: "Test",
      address: null,
      price: null,
      arive_linked: false,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
      ...overrides,
    } as ApiDeal;
  }

  it("uses the manual closing_date for a non-ARIVE deal", () => {
    const deal = apiDealToFrontend(
      makeDeal({ arive_linked: false, arive_key_dates: null, closing_date: "2026-09-30" })
    );
    expect(deal.timeline.closingDate).toBe("2026-09-30");
  });

  it("prefers the ARIVE key date over the manual closing_date when both are present", () => {
    const deal = apiDealToFrontend(
      makeDeal({
        arive_linked: true,
        arive_key_dates: { estimatedFundingDate: "2026-12-01" },
        closing_date: "2026-09-30",
      })
    );
    expect(deal.timeline.closingDate).toBe("2026-12-01");
  });

  it("closingDate is undefined when neither source has a date", () => {
    const deal = apiDealToFrontend(
      makeDeal({ arive_linked: false, arive_key_dates: null, closing_date: null })
    );
    expect(deal.timeline.closingDate).toBeUndefined();
  });
});
