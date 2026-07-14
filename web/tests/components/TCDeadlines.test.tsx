// @vitest-environment happy-dom
/**
 * TC Deadlines — checklist due dates + nav icon (#302).
 *
 * Deadlines() built its list from tasks and contingencies only; checklistEntries
 * was hardcoded [] (~line 286) so an entire deadline source silently vanished,
 * even though DeadlineEntry models source:'checklist' and SOURCE_BADGE.checklist
 * exists. These tests drive the exported Deadlines() with its data hooks mocked
 * at the module boundary (mirroring TCDocuments.test.tsx) and assert:
 *   1. an unchecked checklist item with a due date now surfaces as a
 *      source:'checklist' deadline, aggregated across the TC's deals;
 *   2. a checked-off checklist item is excluded even with a due date.
 * A third test guards that the TC nav's "Contacts" entry no longer uses the
 * MessageSquare (messaging bubble) icon that made it read like a message inbox.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageSquare } from "lucide-react";
import { Deadlines } from "@/components/pages/tc/TCDashboard";
import { TC_NAV } from "@/components/layout/AppLayout";
import type { Deal } from "@/lib/types";
import type { ChecklistItem } from "@/hooks/useChecklist";

// Deals come from useMyDeals() → useDeals().
let currentDeals: Deal[] = [];
vi.mock("@/hooks/useDeals", () => ({
  useDeals: () => ({ deals: currentDeals, loading: false, error: null, refresh: vi.fn() }),
}));

// Tasks and contingencies are the two sources that already worked — keep them
// empty so the checklist source is what drives (or fails to drive) the list.
vi.mock("@/hooks/useTasks", () => ({
  useAgentTasks: () => ({ tasks: [], loading: false, refresh: vi.fn() }),
}));

vi.mock("@/hooks/useContingencies", () => ({
  useContingencies: () => ({
    items: [], loading: false, refresh: vi.fn(),
    updateStatus: vi.fn(), addItem: vi.fn(), removeItem: vi.fn(),
  }),
  useAllContingenciesForDeals: () => [],
}));

// The new aggregate the fix introduces — the checklist analogue of
// useAllContingenciesForDeals.
const useAllChecklistsMock = vi.fn();
vi.mock("@/hooks/useAllChecklists", () => ({
  useAllChecklistsForDeals: (...a: unknown[]) => useAllChecklistsMock(...a),
}));

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "deal-abc-123",
    clientName: "Jane Buyer",
    stage: "under_contract",
    property: { address: "742 Evergreen Terrace" },
    ...overrides,
  } as unknown as Deal;
}

function makeChecklistItem(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id: "cl-1",
    dealId: "deal-abc-123",
    label: "Wire earnest money",
    category: "Contract",
    checked: false,
    assignedTo: "tc",
    dueDate: undefined,
    isCustom: false,
    sortOrder: 0,
    ...overrides,
  };
}

// A date string N days out (YYYY-MM-DD), so the test is stable regardless of
// when it runs.
function futureDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

beforeEach(() => {
  vi.clearAllMocks();
  currentDeals = [makeDeal()];
  useAllChecklistsMock.mockReturnValue([]);
});

describe("TC Deadlines — checklist due dates (#302)", () => {
  it("surfaces an unchecked checklist item with a due date as a 'checklist' deadline", () => {
    useAllChecklistsMock.mockReturnValue([
      makeChecklistItem({ id: "cl-1", label: "Wire earnest money", dueDate: futureDate(10), checked: false }),
    ]);

    render(<Deadlines />);

    // Aggregated across the TC's REAL deal ids (mirrors the contingency path).
    expect(useAllChecklistsMock).toHaveBeenCalledWith(["deal-abc-123"]);

    // The checklist item now surfaces as a deadline row...
    expect(screen.getByText("Wire earnest money")).toBeInTheDocument();
    // ...tagged with the checklist source badge (proves source:'checklist').
    expect(screen.getByText("checklist")).toBeInTheDocument();
    // ...and it's not the empty state.
    expect(screen.queryByText(/no open deadlines/i)).not.toBeInTheDocument();
  });

  it("excludes a checked-off checklist item even when it has a due date", () => {
    useAllChecklistsMock.mockReturnValue([
      makeChecklistItem({ id: "cl-done", label: "Signed disclosures", dueDate: futureDate(5), checked: true }),
    ]);

    render(<Deadlines />);

    expect(screen.queryByText("Signed disclosures")).not.toBeInTheDocument();
    expect(screen.queryByText("checklist")).not.toBeInTheDocument();
    // With nothing else due, the empty state shows.
    expect(screen.getByText(/no open deadlines/i)).toBeInTheDocument();
  });
});

describe("TC nav — Contacts icon is not a messaging bubble (#302)", () => {
  it("does not use the MessageSquare icon for the Contacts entry", () => {
    const contacts = TC_NAV.find((i) => i.label === "Contacts");
    expect(contacts).toBeDefined();
    expect(contacts!.icon).not.toBe(MessageSquare);
  });
});
