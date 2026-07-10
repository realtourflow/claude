"use client";

/**
 * Add-custom-line control for the agent net-sheet editor (#181).
 *
 * Small extracted component: collapsed it's a single "+ Add custom line"
 * button; expanded it's a label + amount form that emits a NetSheetLine
 * (via createCustomLine) through onAdd. The host editor appends the line to
 * its local lines state and persists it with the normal net-sheet save.
 *
 * Extracted (rather than inlined in the editor) because the agent editor
 * lives in DealDetail.tsx's SellerNetSheetCard — mount there with:
 *   <AddCustomLineControl onAdd={(line) => setLines((prev) => [...prev, line])} />
 * Custom lines are non-required, so the existing optional-lines section
 * renders them with the enable toggle and amount editing for free.
 */
import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { createCustomLine, type NetSheetLine } from "@/hooks/useNetSheet";

export function AddCustomLineControl({ onAdd }: { onAdd: (line: NetSheetLine) => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const labelId = useId();
  const amountId = useId();

  function reset() {
    setOpen(false);
    setLabel("");
    setAmount("");
  }

  function handleAdd() {
    const trimmed = label.trim();
    if (!trimmed) return;
    onAdd(createCustomLine(trimmed, parseFloat(amount) || 0));
    reset();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs font-semibold text-brand-navy hover:text-brand-navy/70 transition-colors"
      >
        <Plus size={13} /> Add custom line
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label
            htmlFor={labelId}
            className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1"
          >
            Line label
          </label>
          <input
            id={labelId}
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Staging"
            autoFocus
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none text-brand-navy"
          />
        </div>
        <div>
          <label
            htmlFor={amountId}
            className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1"
          >
            Amount
          </label>
          <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2">
            <span className="text-sm text-gray-400">$</span>
            <input
              id={amountId}
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="flex-1 text-sm outline-none bg-transparent text-brand-navy min-w-0"
            />
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleAdd}
          disabled={!label.trim()}
          className="rounded-lg bg-brand-navy px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-navy/90 disabled:opacity-50 transition-colors"
        >
          Add line
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
