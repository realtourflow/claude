"use client";

import { useState } from "react";
import { Check, AlertCircle } from "lucide-react";
import {
  useAdminFormsList,
  useAdminForm,
  type AdminFormField,
  type CoreKey,
  type FieldPatch,
} from "@/hooks/useAdminForms";
import { FieldPlacementOverlay } from "./FieldPlacementOverlay";

const STATUS_TABS = [
  { id: "pending_review", label: "Pending" },
  { id: "ready", label: "Ready" },
  { id: "rejected", label: "Rejected" },
];

const STATUS_CHIP: Record<string, string> = {
  pending_review: "bg-amber-50 text-amber-700 border-amber-200",
  ready: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  archived: "bg-gray-100 text-gray-500 border-gray-200",
};

export function FormReview() {
  const [statusFilter, setStatusFilter] = useState("pending_review");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = useAdminFormsList(statusFilter);
  const forms = list.data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-brand-navy">Form Review</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Approve agent-uploaded forms before they can be used on deals.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Queue */}
        <div>
          <div className="mb-2 flex gap-1 border-b border-gray-100 pb-px">
            {STATUS_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setStatusFilter(t.id);
                  setSelectedId(null);
                }}
                className={`rounded-t-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                  statusFilter === t.id
                    ? "border-b-2 border-brand-navy text-brand-navy"
                    : "text-gray-400 hover:text-gray-600"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {forms.length === 0 ? (
            <p className="text-sm text-gray-400">Nothing here.</p>
          ) : (
            <ul className="space-y-2">
              {forms.map((f) => (
                <li key={f.id}>
                  <button
                    onClick={() => setSelectedId(f.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left ${
                      selectedId === f.id
                        ? "border-brand-navy bg-brand-navy/5"
                        : "border-gray-100 hover:border-gray-200"
                    }`}
                  >
                    <div className="truncate text-sm font-semibold text-brand-navy">
                      {f.label}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-400">
                      {f.agent_name} · {f.field_count} fields
                      {f.needs_review_count > 0
                        ? ` · ${f.needs_review_count} need review`
                        : ""}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Detail */}
        <div>
          {selectedId ? (
            <FormDetail
              key={selectedId}
              id={selectedId}
              onResolved={() => {
                void list.refetch();
              }}
            />
          ) : (
            <p className="text-sm text-gray-400">Select a form to review.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function FormDetail({ id, onResolved }: { id: string; onResolved: () => void }) {
  const {
    detail,
    loading,
    patchField,
    saveFieldPosition,
    nudgePage,
    addField,
    deleteField,
    confirmPlacement,
    approve,
    reject,
  } = useAdminForm(id);
  const [rejecting, setRejecting] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"placement" | "fields">("placement");
  // Edited signer map; null until the admin changes it, then it overrides the
  // server-derived default. Reset per form via the `key` on FormDetail.
  const [roleMapEdit, setRoleMapEdit] = useState<Record<string, string> | null>(null);

  if (loading || !detail) return <p className="text-sm text-gray-400">Loading…</p>;

  const unresolved = detail.fields.filter((f) => f.needs_review).length;
  const editable = detail.status === "pending_review";
  const roleMap = roleMapEdit ?? detail.derived_signers.roleMapping;
  // A vision OR recognized (remembered-layout) form can't be approved until its
  // placement is confirmed in the overlay — every reviewer re-confirms, so a
  // first-review mistake can't propagate. (Server enforces this too; this guides
  // the admin to the gate.) AcroForm forms are exempt (exact native positions).
  const placementBlocked =
    (detail.detection_source === "vision" || detail.detection_source === "recognized") &&
    !detail.placement_confirmed_at;

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-brand-navy">{detail.label}</h2>
          <p className="text-xs text-gray-400">
            {detail.agent_name} · {detail.source_file_name}
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${
            STATUS_CHIP[detail.status] ?? STATUS_CHIP.archived
          }`}
        >
          {detail.status.replace("_", " ")}
        </span>
      </header>

      <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
        <span className="font-semibold">Attestation:</span> “
        {detail.attestation_statement}” — {detail.agent_name}
        {detail.attested_at ? ` on ${detail.attested_at.slice(0, 10)}` : ""}
      </p>

      {/* Placement (visual overlay) vs Fields (mapping table). */}
      <div className="flex gap-1 border-b border-gray-100">
        {(["placement", "fields"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`rounded-t-lg px-3 py-1.5 text-sm font-semibold capitalize transition-colors ${
              view === v
                ? "border-b-2 border-brand-navy text-brand-navy"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {v}
            {v === "placement" && placementBlocked ? " ⚠" : ""}
          </button>
        ))}
      </div>

      {view === "placement" ? (
        <FieldPlacementOverlay
          formId={detail.id}
          fields={detail.fields}
          pages={detail.pages}
          typeFields={detail.type_fields}
          confirmed={!!detail.placement_confirmed_at}
          onSave={saveFieldPosition}
          onConfirm={async () => {
            await confirmPlacement();
          }}
          onNudgePage={nudgePage}
          onAddField={addField}
          onDeleteField={deleteField}
        />
      ) : (
        <>
          {detail.preview_url && (
            <object
              data={detail.preview_url}
              type="application/pdf"
              className="h-80 w-full rounded-lg border border-gray-100"
              aria-label="Form preview"
            />
          )}
          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">Detected field</th>
                  <th className="px-3 py-2 font-semibold">AI proposal</th>
                  <th className="px-3 py-2 font-semibold">Mapping</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {detail.fields.map((f) => (
                  <FieldRow
                    key={f.id}
                    field={f}
                    coreKeys={detail.core_keys}
                    editable={editable}
                    onPatch={patchField}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editable && Object.keys(roleMap).length > 0 && (
        <div className="rounded-lg border border-gray-100 p-3">
          <h3 className="text-sm font-semibold text-brand-navy">Signers</h3>
          <p className="mb-2 text-xs text-gray-400">
            Derived from the field roles — edit the template role names before
            approving.
          </p>
          <div className="space-y-1.5">
            {Object.entries(roleMap).map(([participant, role]) => (
              <div key={participant} className="flex items-center gap-2 text-sm">
                <span className="w-24 shrink-0 capitalize text-gray-500">
                  {participant}
                </span>
                <span className="text-gray-300">→</span>
                <input
                  value={role}
                  onChange={(e) =>
                    setRoleMapEdit((m) => ({
                      ...(m ?? roleMap),
                      [participant]: e.target.value,
                    }))
                  }
                  className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {editable && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={unresolved > 0 || placementBlocked || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await approve({
                  role_mapping: roleMap,
                  routing: "by-role",
                  consumer_roles: [],
                });
                onResolved();
              } finally {
                setBusy(false);
              }
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check size={15} />
            {placementBlocked
              ? "Confirm placement first"
              : unresolved > 0
                ? `Approve (${unresolved} unresolved)`
                : "Approve"}
          </button>
          <button
            type="button"
            onClick={() => setRejecting((v) => !v)}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
          >
            Reject
          </button>
        </div>
      )}

      {rejecting && (
        <div className="space-y-2 rounded-lg border border-red-100 bg-red-50/50 p-3">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Reason (shown to the agent)"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-navy focus:outline-none"
            rows={2}
          />
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await reject(notes);
                onResolved();
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            Confirm rejection
          </button>
        </div>
      )}

      {detail.status === "ready" && (
        <p className="flex items-center gap-2 text-xs text-gray-500">
          <AlertCircle size={14} className="shrink-0" />
          Approved. It becomes sendable on deals once its DocuSign template is
          created (a later build step).
        </p>
      )}
    </div>
  );
}

function FieldRow({
  field,
  coreKeys,
  editable,
  onPatch,
}: {
  field: AdminFormField;
  coreKeys: CoreKey[];
  editable: boolean;
  onPatch: (fieldId: string, patch: FieldPatch) => Promise<void>;
}) {
  const [coreKey, setCoreKey] = useState(field.final_core_key ?? field.ai_core_key ?? "");
  const [role, setRole] = useState(field.final_role ?? field.ai_role ?? "");
  const [saving, setSaving] = useState(false);

  async function apply(skip: boolean) {
    setSaving(true);
    try {
      await onPatch(
        field.id,
        skip
          ? { final_core_key: null, decision: "skipped" }
          : {
              final_core_key: coreKey || null,
              final_role: role || null,
              final_type: field.detected_type,
              decision: coreKey ? "corrected" : "skipped",
            }
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-t border-gray-100 align-top">
      <td className="px-3 py-2">
        <div className="font-medium text-brand-navy">{field.detected_name}</div>
        <div className="text-xs text-gray-400">
          {field.detected_type} · p{field.page_number}
        </div>
        {field.needs_review && (
          <span className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
            needs review
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500">
        {field.ai_core_key ?? "—"}
        {field.ai_confidence != null && (
          <span className="text-gray-400">
            {" "}
            ({Math.round(field.ai_confidence * 100)}%)
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <select
          value={coreKey}
          disabled={!editable}
          onChange={(e) => setCoreKey(e.target.value)}
          className="block w-full rounded border border-gray-200 px-2 py-1 text-xs disabled:bg-gray-50"
        >
          <option value="">(unmapped — signer fills)</option>
          {coreKeys.map((k) => (
            <option key={k.key} value={k.key}>
              {k.key}
            </option>
          ))}
        </select>
        <input
          value={role}
          disabled={!editable}
          onChange={(e) => setRole(e.target.value)}
          placeholder="role (Buyer / Seller / Agent)"
          className="mt-1 block w-full rounded border border-gray-200 px-2 py-1 text-xs disabled:bg-gray-50"
        />
      </td>
      <td className="px-3 py-2 text-right">
        {editable ? (
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              disabled={saving}
              onClick={() => apply(false)}
              className="rounded bg-brand-navy px-2 py-1 text-xs font-semibold text-white disabled:opacity-40"
            >
              Apply
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => apply(true)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Skip
            </button>
          </div>
        ) : (
          field.decision !== "pending" && (
            <span className="text-xs text-green-600">✓ {field.decision}</span>
          )
        )}
      </td>
    </tr>
  );
}
