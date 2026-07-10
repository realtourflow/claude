"use client";

/**
 * Add-contingency control (#186).
 *
 * Collapsed it's a single "+ Add contingency" button; expanded it's a
 * label + type + optional-deadline form that calls onAdd(label, type,
 * deadline?). Mounted in both the TC dashboard's per-deal contingency card
 * (TCDashboard.tsx) and the agent DealDetail overview's ContingenciesCard —
 * both wire onAdd straight to useContingencies(dealId).addItem, which POSTs
 * /api/deals/:id/contingencies and updates the query cache.
 */
import { useId, useState } from "react";
import { Plus } from "lucide-react";
import type { ContingencyType } from "@/hooks/useContingencies";

const TYPE_OPTIONS: { value: ContingencyType; label: string }[] = [
  { value: "inspection", label: "Inspection" },
  { value: "financing", label: "Financing" },
  { value: "appraisal", label: "Appraisal" },
  { value: "hoa", label: "HOA" },
  { value: "custom", label: "Other" },
];

export function AddContingencyForm({
  onAdd,
}: {
  onAdd: (
    label: string,
    type: ContingencyType,
    deadline?: string
  ) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<ContingencyType>("inspection");
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);
  const labelId = useId();
  const typeId = useId();
  const deadlineId = useId();

  function reset() {
    setOpen(false);
    setLabel("");
    setType("inspection");
    setDeadline("");
  }

  async function handleAdd() {
    const trimmed = label.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onAdd(trimmed, type, deadline || undefined);
      reset();
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs font-semibold text-brand-navy hover:text-brand-navy/70 transition-colors"
      >
        <Plus size={13} /> Add contingency
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="col-span-2 sm:col-span-1">
          <label
            htmlFor={labelId}
            className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1"
          >
            Label
          </label>
          <input
            id={labelId}
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Inspection contingency"
            autoFocus
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none text-brand-navy"
          />
        </div>
        <div>
          <label
            htmlFor={typeId}
            className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1"
          >
            Type
          </label>
          <select
            id={typeId}
            value={type}
            onChange={(e) => setType(e.target.value as ContingencyType)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none text-brand-navy"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor={deadlineId}
            className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1"
          >
            Deadline
          </label>
          <input
            id={deadlineId}
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none text-brand-navy"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleAdd}
          disabled={!label.trim() || saving}
          className="rounded-lg bg-brand-navy px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-navy/90 disabled:opacity-50 transition-colors"
        >
          {saving ? "Adding…" : "Add"}
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
