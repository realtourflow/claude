// @vitest-environment happy-dom
/**
 * TimelineTab — real per-stage durations (#256).
 *
 * The tab used to key past-stage durations off a hardcoded DEAL_STAGE_DAYS
 * table keyed to legacy mock ids ('deal-smith'…), so real (UUID) deals never
 * showed a duration. It now derives each past stage's length from the deal's
 * real `deal_stage_history` (fetched via useStageHistory): time between
 * consecutive transitions, and created_at -> first transition for the first
 * stage.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimelineTab } from "@/components/deal/TimelineTab";
import type { Deal } from "@/lib/types";

const useStageHistory = vi.fn();
vi.mock("@/hooks/useStageHistory", () => ({
  useStageHistory: (dealId: string) => useStageHistory(dealId),
}));

// A real deal has a UUID id — the mock table was keyed to 'deal-smith'-style
// ids, so this must resolve durations from history, never a static lookup.
const DEAL = {
  id: "11111111-1111-1111-1111-111111111111",
  stage: "offer_active",
  type: "buy",
  clientName: "Jane Doe",
  timeline: { createdAt: "2026-01-01T00:00:00.000Z", daysInStage: 3 },
} as unknown as Deal;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TimelineTab — real per-stage durations (#256)", () => {
  it("derives durations from deal_stage_history for each past stage", () => {
    useStageHistory.mockReturnValue({
      history: [
        {
          from_stage: "intake",
          to_stage: "active_search",
          changed_at: "2026-01-06T00:00:00.000Z", // intake: Jan 1 -> Jan 6 = 5d
          changed_by: "u1",
        },
        {
          from_stage: "active_search",
          to_stage: "offer_active",
          changed_at: "2026-01-26T00:00:00.000Z", // active_search: Jan 6 -> Jan 26 = 20d
          changed_by: "u1",
        },
      ],
      loading: false,
    });

    render(<TimelineTab deal={DEAL} tasks={[]} />);

    expect(screen.getByText("5d")).toBeInTheDocument();
    expect(screen.getByText("20d")).toBeInTheDocument();
    // The current stage keeps its live "so far" counter (not a finished duration).
    expect(screen.getByText(/3d so far/)).toBeInTheDocument();
    // The retired mock had active_search=21d for 'deal-smith'; it must be gone.
    expect(screen.queryByText("21d")).toBeNull();
  });

  it("shows no past-stage duration numbers when history is empty", () => {
    useStageHistory.mockReturnValue({ history: [], loading: false });

    render(<TimelineTab deal={DEAL} tasks={[]} />);

    // No completed-stage "Nd" badge renders — nothing is fabricated.
    expect(screen.queryByText(/^\d+d$/)).toBeNull();
    // The live current-stage counter is unaffected by empty history.
    expect(screen.getByText(/3d so far/)).toBeInTheDocument();
  });
});
