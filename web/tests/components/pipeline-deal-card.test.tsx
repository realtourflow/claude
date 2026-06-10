// @vitest-environment happy-dom
/**
 * Regression test for Pipeline deal cards showing real task counts (#80).
 *
 * DealCard used to derive its task pills from MOCK_TASKS filtered by
 * deal.id. Real deals have UUIDs and mock tasks don't, so the filter
 * always returned [] — every card showed the green "All tasks done"
 * pill and the red overdue badge never rendered. The card must instead
 * read the API-backed count fields the deals adapter already maps
 * (Deal.openTaskCount / Deal.overdueTaskCount, from open_task_count /
 * overdue_task_count in hooks/useDeals.ts).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DealCard } from "@/components/pages/agent/Pipeline";
import type { Deal } from "@/lib/data/mockDeals";

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "5f0f6f6a-9b1c-4f6e-8a2d-3c4b5a697e01",
    type: "buy",
    clientName: "Jane Buyer",
    clientId: "",
    agentId: "agent-1",
    stage: "under_contract",
    health: "green",
    priority: "medium",
    property: {
      address: "123 Main Street",
      city: "Birmingham",
      state: "AL",
      zip: "35203",
      price: 350000,
    },
    timeline: {
      createdAt: "2026-05-01T00:00:00Z",
      daysInStage: 4,
    },
    flags: [],
    status: "active",
    estimatedCommission: 10500,
    openTaskCount: 0,
    overdueTaskCount: 0,
    ...overrides,
  };
}

describe("Pipeline DealCard task pills", () => {
  it("renders the overdue badge when overdueTaskCount > 0", () => {
    render(<DealCard deal={makeDeal({ openTaskCount: 5, overdueTaskCount: 2 })} />);
    expect(screen.getByText("2 overdue")).toBeTruthy();
    expect(screen.queryByText("All tasks done")).toBeNull();
  });

  it("shows the open-task pill — not 'All tasks done' — when openTaskCount > 0 and nothing is overdue", () => {
    render(<DealCard deal={makeDeal({ openTaskCount: 3, overdueTaskCount: 0 })} />);
    expect(screen.getByText("3 open tasks")).toBeTruthy();
    expect(screen.queryByText("All tasks done")).toBeNull();
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });

  it("shows 'All tasks done' only when openTaskCount === 0", () => {
    render(<DealCard deal={makeDeal({ openTaskCount: 0, overdueTaskCount: 0 })} />);
    expect(screen.getByText("All tasks done")).toBeTruthy();
    expect(screen.queryByText(/open task/i)).toBeNull();
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });
});
