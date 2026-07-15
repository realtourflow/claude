"use client";

import { FileSignature } from "lucide-react";
import {
  useAgentForms,
  type FormSide,
  type FormStatus,
  type UploadedForm,
} from "@/hooks/useAgentForms";
import FormUploader from "@/components/FormUploader";

const SIDE_LABELS: Record<FormSide, string> = {
  buy: "Buyer-side",
  sell: "Seller-side",
  both: "Both sides",
};

const STATUS_STYLES: Record<FormStatus, { label: string; cls: string }> = {
  detecting: { label: "Detecting fields…", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  pending_review: { label: "Pending review", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  pending_split: { label: "Awaiting split", cls: "bg-purple-50 text-purple-700 border-purple-200" },
  split: { label: "Split into separate forms", cls: "bg-gray-100 text-gray-500 border-gray-200" },
  ready: { label: "Ready", cls: "bg-green-50 text-green-700 border-green-200" },
  rejected: { label: "Rejected", cls: "bg-red-50 text-red-700 border-red-200" },
  archived: { label: "Archived", cls: "bg-gray-100 text-gray-500 border-gray-200" },
};

function StatusChip({ status }: { status: FormStatus }) {
  // The API can return statuses this build doesn't know yet (`fromApi` casts
  // the raw string). One unknown status must never crash the whole section —
  // fall back to a neutral chip showing the humanized raw value (issue #194).
  const s: { label: string; cls: string } | undefined = STATUS_STYLES[status];
  if (!s) {
    return (
      <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold bg-gray-100 text-gray-500 border-gray-200">
        {String(status).replace(/_/g, " ")}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

function FormRow({ form }: { form: UploadedForm }) {
  // #295 — a rejected form must show WHY. Surface the admin's review note under
  // the chip so the agent can act on the reason, not just see a bare "Rejected".
  const rejectionReason =
    form.status === "rejected" && form.reviewNotes?.trim()
      ? form.reviewNotes.trim()
      : null;

  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <FileSignature size={15} className="shrink-0 text-gray-400" />
          <span className="truncate text-sm font-semibold text-brand-navy">
            {form.label}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-gray-400">
          {SIDE_LABELS[form.side]} · {form.fieldCount} field
          {form.fieldCount === 1 ? "" : "s"}
          {form.needsReviewCount > 0
            ? ` · ${form.needsReviewCount} need review`
            : ""}
        </p>
        {rejectionReason && (
          <p className="mt-1 text-xs text-red-600">
            <span className="font-semibold">Reason:</span> {rejectionReason}
          </p>
        )}
      </div>
      <StatusChip status={form.status} />
    </li>
  );
}

export function MyFormsSection() {
  const { forms, loading } = useAgentForms();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-brand-navy">My Forms</h2>
        <p className="text-sm text-gray-400 mt-0.5">
          Upload a blank form and we&apos;ll turn it into a signable template. Each
          form is reviewed before it becomes available on your deals.
        </p>
      </div>

      <FormUploader />

      {/* Existing forms */}
      <div>
        <h3 className="text-sm font-semibold text-brand-navy mb-2">
          Your uploaded forms
        </h3>
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : forms.length === 0 ? (
          <p className="text-sm text-gray-400">No forms uploaded yet.</p>
        ) : (
          <ul className="space-y-2">
            {forms.map((f) => (
              <FormRow key={f.id} form={f} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
