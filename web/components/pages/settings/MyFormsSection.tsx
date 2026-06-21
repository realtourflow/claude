"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, FileSignature, AlertCircle } from "lucide-react";
import {
  useAgentForms,
  type FormSide,
  type FormStatus,
  type UploadedForm,
} from "@/hooks/useAgentForms";

const SIDE_LABELS: Record<FormSide, string> = {
  buy: "Buyer-side",
  sell: "Seller-side",
  both: "Both sides",
};

const STATUS_STYLES: Record<FormStatus, { label: string; cls: string }> = {
  detecting: { label: "Detecting fields…", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  pending_review: { label: "Pending review", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  ready: { label: "Ready", cls: "bg-green-50 text-green-700 border-green-200" },
  rejected: { label: "Rejected", cls: "bg-red-50 text-red-700 border-red-200" },
  archived: { label: "Archived", cls: "bg-gray-100 text-gray-500 border-gray-200" },
};

const MAX_BYTES = 25 * 1024 * 1024;

function StatusChip({ status }: { status: FormStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

function FormRow({ form }: { form: UploadedForm }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2.5">
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
      </div>
      <StatusChip status={form.status} />
    </li>
  );
}

export function MyFormsSection() {
  const { forms, loading, formTypes, uploadForm, getAttestation } = useAgentForms();

  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [side, setSide] = useState<FormSide>("buy");
  const [formType, setFormType] = useState("");
  const [attested, setAttested] = useState(false);
  const [statement, setStatement] = useState(
    "I attest that I am licensed and permitted to use and host this form."
  );
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getAttestation()
      .then(setStatement)
      .catch(() => {
        /* keep the default wording */
      });
    // getAttestation identity is stable enough for a one-shot fetch on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickFile(f: File | null) {
    setErr(null);
    if (!f) {
      setFile(null);
      return;
    }
    if (!f.name.toLowerCase().endsWith(".pdf") && f.type !== "application/pdf") {
      setErr("Please choose a PDF file.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setErr("That file is over 25 MB.");
      return;
    }
    setFile(f);
    if (!label.trim()) setLabel(f.name.replace(/\.pdf$/i, ""));
  }

  function reset() {
    setFile(null);
    setLabel("");
    setSide("buy");
    setFormType("");
    setAttested(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleSubmit() {
    if (!file || !label.trim() || !formType || !attested || submitting) return;
    setSubmitting(true);
    setErr(null);
    try {
      await uploadForm(file, label, side, attested, formType);
      reset();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    !!file && !!label.trim() && !!formType && attested && !submitting;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-brand-navy">My Forms</h2>
        <p className="text-sm text-gray-400 mt-0.5">
          Upload a blank form and we&apos;ll turn it into a signable template. Each
          form is reviewed before it becomes available on your deals.
        </p>
      </div>

      {/* Upload card */}
      <div className="rounded-xl border border-gray-100 p-4 space-y-4">
        <label className="block">
          <span className="text-sm font-semibold text-brand-navy">PDF form</span>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm text-gray-500 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-brand-navy hover:file:bg-gray-200"
          />
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-brand-navy">
            Document type
          </span>
          <select
            value={formType}
            onChange={(e) => setFormType(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-navy focus:outline-none"
          >
            <option value="">Select the type of document…</option>
            {formTypes.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-gray-400">
            Tell us what this is (e.g. your purchase agreement) so we can place its
            fields for you.
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold text-brand-navy">Name</span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Listing Agreement"
              className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-navy focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-brand-navy">Used on</span>
            <select
              value={side}
              onChange={(e) => setSide(e.target.value as FormSide)}
              className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-navy focus:outline-none"
            >
              <option value="buy">Buyer-side deals</option>
              <option value="sell">Seller-side deals</option>
              <option value="both">Both sides</option>
            </select>
          </label>
        </div>

        {/* Required licensing attestation */}
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={attested}
            onChange={(e) => setAttested(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-brand-navy focus:ring-brand-navy"
          />
          <span className="text-sm text-gray-600">{statement}</span>
        </label>

        {err && (
          <div className="flex items-center gap-2 text-sm text-red-600">
            <AlertCircle size={15} className="shrink-0" />
            {err}
          </div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Upload size={15} />
          {submitting ? "Uploading…" : "Upload form"}
        </button>
      </div>

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
