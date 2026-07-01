"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, AlertCircle, Search, ChevronDown, Check } from "lucide-react";
import { useAgentForms, type FormSide } from "@/hooks/useAgentForms";

const MAX_BYTES = 25 * 1024 * 1024;

// Shared agent form-upload card (Vision pipeline / uploaded_forms). Searchable
// form-type catalog + required licensing attestation. Used in agent onboarding
// AND Settings → My Forms so both stay identical. Uploads one form at a time and
// resets, so an agent uploads each of their forms in turn.
export default function FormUploader({ onUploaded }: { onUploaded?: () => void }) {
  const { formTypes, uploadForm, getAttestation } = useAgentForms();

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

  // Searchable form-type combobox.
  const [typeOpen, setTypeOpen] = useState(false);
  const [typeQuery, setTypeQuery] = useState("");
  const typeRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getAttestation().then(setStatement).catch(() => {
      /* keep the default wording */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (typeRef.current && !typeRef.current.contains(e.target as Node)) setTypeOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const selectedLabel = formTypes.find((t) => t.key === formType)?.label ?? "";
  const q = typeQuery.trim().toLowerCase();
  const filtered = q ? formTypes.filter((t) => t.label.toLowerCase().includes(q)) : formTypes;

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
    setTypeQuery("");
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
      onUploaded?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = !!file && !!label.trim() && !!formType && attested && !submitting;

  return (
    <div className="rounded-xl border border-gray-100 p-4 space-y-4">
      {/* File */}
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

      {/* Searchable document-type picker (the master forms catalog) */}
      <div ref={typeRef}>
        <span className="text-sm font-semibold text-brand-navy">Document type</span>
        <div className="relative mt-1">
          <button
            type="button"
            onClick={() => setTypeOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-left text-sm focus:border-brand-navy focus:outline-none"
          >
            <span className={selectedLabel ? "text-brand-navy" : "text-gray-400"}>
              {selectedLabel || "Search for the form…"}
            </span>
            <ChevronDown size={15} className="shrink-0 text-gray-400" />
          </button>
          {typeOpen && (
            <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
              <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
                <Search size={14} className="shrink-0 text-gray-400" />
                <input
                  autoFocus
                  value={typeQuery}
                  onChange={(e) => setTypeQuery(e.target.value)}
                  placeholder="Type to search forms…"
                  className="w-full text-sm text-brand-navy outline-none placeholder:text-gray-300"
                />
              </div>
              <ul className="max-h-56 overflow-y-auto py-1">
                {filtered.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-gray-400">No matching forms.</li>
                ) : (
                  filtered.map((t) => (
                    <li key={t.key}>
                      <button
                        type="button"
                        onClick={() => {
                          setFormType(t.key);
                          setTypeOpen(false);
                          setTypeQuery("");
                          if (!label.trim()) setLabel(t.label);
                        }}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-brand-bg"
                      >
                        <span className="text-brand-navy">{t.label}</span>
                        {formType === t.key && <Check size={14} className="shrink-0 text-green-500" />}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </div>
        <span className="mt-1 block text-xs text-gray-400">
          Search and pick what this document is so we can place its fields for you.
        </span>
      </div>

      {/* Name + side */}
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
  );
}
