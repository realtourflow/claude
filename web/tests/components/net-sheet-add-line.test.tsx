// @vitest-environment happy-dom
/**
 * Add-custom-line control for the agent net sheet (#181).
 *
 * The agent editor (SellerNetSheetCard in DealDetail.tsx) had no way to add a
 * deduction line the defaults don't cover. AddCustomLineControl is a small
 * extracted component: label + amount → onAdd(NetSheetLine). It renders the
 * new line via createCustomLine from the net-sheet hook so ids stay unique
 * and the line shape matches what the API persists.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { AddCustomLineControl } from "@/components/net-sheet/AddCustomLineControl";
import { createCustomLine, type NetSheetLine } from "@/hooks/useNetSheet";

describe("createCustomLine", () => {
  it("builds an enabled, editable custom line with a unique id", () => {
    const a = createCustomLine("Staging", 1200);
    const b = createCustomLine("Staging", 1200);

    expect(a.label).toBe("Staging");
    expect(a.amount).toBe(1200);
    expect(a.category).toBe("custom");
    expect(a.isPct).toBe(false);
    expect(a.pct).toBeNull();
    expect(a.required).toBe(false);
    expect(a.enabled).toBe(true);
    expect(a.editable).toBe(true);
    expect(a.autoPopulated).toBe(false);
    expect(a.id.startsWith("custom_")).toBe(true);
    expect(a.id).not.toBe(b.id);
  });

  it("clamps negative and non-finite amounts to 0", () => {
    expect(createCustomLine("Weird", -50).amount).toBe(0);
    expect(createCustomLine("Weird", Number.NaN).amount).toBe(0);
  });
});

describe("AddCustomLineControl", () => {
  function setup() {
    const onAdd = vi.fn<(line: NetSheetLine) => void>();
    render(<AddCustomLineControl onAdd={onAdd} />);
    return { onAdd };
  }

  it("expands from a button into label + amount inputs", () => {
    setup();
    expect(screen.queryByLabelText(/line label/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /add custom line/i }));

    expect(screen.getByLabelText(/line label/i)).toBeTruthy();
    expect(screen.getByLabelText(/amount/i)).toBeTruthy();
  });

  it("calls onAdd with the new line and collapses back", () => {
    const { onAdd } = setup();
    fireEvent.click(screen.getByRole("button", { name: /add custom line/i }));

    fireEvent.change(screen.getByLabelText(/line label/i), { target: { value: "Staging" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: /^add line$/i }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const line = onAdd.mock.calls[0][0];
    expect(line.label).toBe("Staging");
    expect(line.amount).toBe(1200);
    expect(line.category).toBe("custom");
    expect(line.enabled).toBe(true);

    // Form collapsed again after adding.
    expect(screen.queryByLabelText(/line label/i)).toBeNull();
  });

  it("does not add when the label is empty", () => {
    const { onAdd } = setup();
    fireEvent.click(screen.getByRole("button", { name: /add custom line/i }));
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: /^add line$/i }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("cancel collapses without adding", () => {
    const { onAdd } = setup();
    fireEvent.click(screen.getByRole("button", { name: /add custom line/i }));
    fireEvent.change(screen.getByLabelText(/line label/i), { target: { value: "Staging" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/line label/i)).toBeNull();
  });
});
