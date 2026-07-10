// @vitest-environment happy-dom
/**
 * Add-contingency form (#186).
 *
 * deal_contingencies had a full CRUD API and useContingencies exposed
 * addItem(label, type, deadline), but nothing in the app called it — the
 * contingency deadline tracker was permanently empty. AddContingencyForm is a
 * small shared control (label + type + optional deadline → onAdd) mounted in
 * both the TC dashboard's per-deal contingency card and the agent DealDetail
 * overview's ContingenciesCard.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddContingencyForm } from "@/components/contingencies/AddContingencyForm";
import type { Deal } from "@/lib/data/mockDeals";

const addItem = vi.fn();
const updateStatus = vi.fn();
const removeItem = vi.fn();

vi.mock("@/hooks/useContingencies", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useContingencies")>();
  return {
    ...actual,
    useContingencies: vi.fn(() => ({
      items: [],
      loading: false,
      refresh: vi.fn(),
      updateStatus,
      addItem,
      removeItem,
    })),
    useAllContingenciesForDeals: vi.fn(() => []),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  addItem.mockResolvedValue(undefined);
});

describe("AddContingencyForm", () => {
  function setup() {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddContingencyForm onAdd={onAdd} />);
    return { onAdd };
  }

  it("expands from a button into label + type + deadline inputs", () => {
    setup();
    expect(screen.queryByLabelText(/label/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /add contingency/i }));

    expect(screen.getByLabelText(/label/i)).toBeTruthy();
    expect(screen.getByLabelText(/type/i)).toBeTruthy();
    expect(screen.getByLabelText(/deadline/i)).toBeTruthy();
  });

  it("calls onAdd with label, type, and deadline, then collapses", async () => {
    const { onAdd } = setup();
    fireEvent.click(screen.getByRole("button", { name: /add contingency/i }));

    fireEvent.change(screen.getByLabelText(/label/i), {
      target: { value: "Inspection contingency" },
    });
    fireEvent.change(screen.getByLabelText(/type/i), {
      target: { value: "inspection" },
    });
    fireEvent.change(screen.getByLabelText(/deadline/i), {
      target: { value: "2026-07-17" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith(
        "Inspection contingency",
        "inspection",
        "2026-07-17"
      )
    );
    // Collapsed again after adding.
    await waitFor(() => expect(screen.queryByLabelText(/label/i)).toBeNull());
  });

  it("omits the deadline when left blank", async () => {
    const { onAdd } = setup();
    fireEvent.click(screen.getByRole("button", { name: /add contingency/i }));

    fireEvent.change(screen.getByLabelText(/label/i), {
      target: { value: "HOA docs review" },
    });
    fireEvent.change(screen.getByLabelText(/type/i), {
      target: { value: "hoa" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith("HOA docs review", "hoa", undefined)
    );
  });

  it("does not add when the label is empty", () => {
    const { onAdd } = setup();
    fireEvent.click(screen.getByRole("button", { name: /add contingency/i }));
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("cancel collapses without adding", () => {
    const { onAdd } = setup();
    fireEvent.click(screen.getByRole("button", { name: /add contingency/i }));
    fireEvent.change(screen.getByLabelText(/label/i), {
      target: { value: "Financing" },
    });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/label/i)).toBeNull();
  });
});

const TC_DEAL = {
  id: "deal-1",
  clientName: "Jane Doe",
  stage: "under_contract",
  type: "buy",
  property: { address: "123 Elm St" },
} as unknown as Deal;

describe("TC DealContingenciesCard — add form wiring (#186)", () => {
  it("submitting the add form calls useContingencies.addItem", async () => {
    const { DealContingenciesCard } = await import(
      "@/components/pages/tc/TCDashboard"
    );
    render(<DealContingenciesCard deal={TC_DEAL} />);

    fireEvent.click(screen.getByRole("button", { name: /add contingency/i }));
    fireEvent.change(screen.getByLabelText(/label/i), {
      target: { value: "Appraisal contingency" },
    });
    fireEvent.change(screen.getByLabelText(/type/i), {
      target: { value: "appraisal" },
    });
    fireEvent.change(screen.getByLabelText(/deadline/i), {
      target: { value: "2026-07-24" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() =>
      expect(addItem).toHaveBeenCalledWith(
        "Appraisal contingency",
        "appraisal",
        "2026-07-24"
      )
    );
  });
});

describe("Agent ContingenciesCard (DealDetail) — add form wiring (#186)", () => {
  it("submitting the add form calls useContingencies.addItem", async () => {
    const { ContingenciesCard } = await import(
      "@/components/pages/agent/DealDetail"
    );
    render(<ContingenciesCard deal={TC_DEAL} />);

    fireEvent.click(screen.getByRole("button", { name: /add contingency/i }));
    fireEvent.change(screen.getByLabelText(/label/i), {
      target: { value: "Inspection contingency" },
    });
    fireEvent.change(screen.getByLabelText(/deadline/i), {
      target: { value: "2026-07-17" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

    await waitFor(() =>
      expect(addItem).toHaveBeenCalledWith(
        "Inspection contingency",
        "inspection",
        "2026-07-17"
      )
    );
  });
});
