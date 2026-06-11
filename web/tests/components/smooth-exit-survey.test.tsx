// @vitest-environment happy-dom
/**
 * Regression test for the Smooth Exit Detail → Survey handoff (#47 follow-up).
 *
 * SmoothExitDetail stashes { selectedUpsells, upsellTotal, dealId } in
 * sessionStorage under "smoothExitSurveyState" before router.push (Next.js
 * has no react-router `{ state }` second arg). The survey used to hardcode
 * that state to null — a react-router port stub — so dealId was always null,
 * the `if (dealId)` guard never passed, and POST /deals/:id/smoothexit never
 * fired: the user saw the success screen while nothing persisted. The survey
 * must read the stash, post the enrollment, clear the key on success, and
 * show an error — never the success screen — when the API call fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SmoothExitSurvey, {
  HANDOFF_KEY,
} from "@/components/pages/onboarding/SmoothExitSurvey";
import { api } from "@/lib/api-client";

// Mutable so individual tests can simulate a ?dealId= entry point. The `mock`
// prefix is what lets Vitest's hoisted vi.mock factory close over it.
let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/lib/api-client", () => ({
  api: { post: vi.fn() },
}));

const mockPost = api.post as Mock;

const DEAL_ID = "5f0f6f6a-9b1c-4f6e-8a2d-3c4b5a697e01";

function seedHandoff() {
  sessionStorage.setItem(
    HANDOFF_KEY,
    JSON.stringify({
      dealId: DEAL_ID,
      selectedUpsells: ["staging_consult"],
      upsellTotal: 247,
    })
  );
}

/** Click through all four survey screens and hit Submit Request. */
function driveToSubmit() {
  // Screen 0 — what's next
  fireEvent.click(screen.getByText("Buying another home nearby"));
  fireEvent.click(screen.getByText("Continue"));
  // Screen 1 — sale price
  fireEvent.change(screen.getByPlaceholderText("385,000"), {
    target: { value: "400000" },
  });
  fireEvent.click(screen.getByText("Continue"));
  // Screen 2 — move-out preferences
  fireEvent.click(screen.getByText("Coordinate movers for me"));
  fireEvent.click(screen.getByText("Continue"));
  // Screen 3 — confirm + payment option
  fireEvent.click(screen.getByText("From my sale proceeds"));
  fireEvent.click(screen.getByText("Submit Request"));
}

beforeEach(() => {
  sessionStorage.clear();
  mockPost.mockReset();
  mockSearchParams = new URLSearchParams();
});

describe("SmoothExitSurvey handoff", () => {
  it("posts the enrollment to /deals/:id/smoothexit with the stashed upsells", async () => {
    seedHandoff();
    mockPost.mockResolvedValue({ ok: true });
    render(<SmoothExitSurvey />);
    driveToSubmit();

    await screen.findByText("Smooth Exit activated!");
    expect(mockPost).toHaveBeenCalledTimes(1);
    const [path, body] = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(`/deals/${DEAL_ID}/smoothexit`);
    expect(body.selected_upsells).toEqual(["staging_consult"]);
    expect(body.upsell_total_cents).toBe(24700);
  });

  it("clears the sessionStorage handoff key after a successful submit", async () => {
    seedHandoff();
    mockPost.mockResolvedValue({ ok: true });
    render(<SmoothExitSurvey />);
    driveToSubmit();

    await screen.findByText("Smooth Exit activated!");
    expect(sessionStorage.getItem(HANDOFF_KEY)).toBeNull();
  });

  it("ignores a stale cross-deal stash when an explicit ?dealId= is present", async () => {
    // A prior Detail visit left add-ons stashed for DEAL_ID, but the user now
    // arrives via a direct entry point for a DIFFERENT deal. The submit must
    // target the query deal and NOT resurrect the stale add-ons (the confirm
    // screen never shows them).
    seedHandoff();
    const OTHER_DEAL = "11111111-2222-3333-4444-555555555555";
    mockSearchParams = new URLSearchParams({ dealId: OTHER_DEAL });
    mockPost.mockResolvedValue({ ok: true });
    render(<SmoothExitSurvey />);
    driveToSubmit();

    await screen.findByText("Smooth Exit activated!");
    const [path, body] = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(`/deals/${OTHER_DEAL}/smoothexit`);
    expect(body.selected_upsells).toEqual([]);
    expect(body.upsell_total_cents).toBe(0);
  });

  it("shows an error — never the success screen — when the enrollment POST fails", async () => {
    seedHandoff();
    mockPost.mockRejectedValue(new Error("500 — boom"));
    render(<SmoothExitSurvey />);
    driveToSubmit();

    await screen.findByText(/couldn[’']t submit/i);
    expect(screen.queryByText("Smooth Exit activated!")).toBeNull();
    // Handoff is kept so the user can retry without losing the deal id.
    expect(sessionStorage.getItem(HANDOFF_KEY)).not.toBeNull();
  });
});
