"use client";

/**
 * Primary send-for-signature flow: the agent picks a configured standard form
 * (a DocuSign template — fields are tagged on the template, so placement is
 * always correct) and roles auto-fill from the deal's participants. Roles
 * nobody on the deal can fill take an outside signer's email/name — those
 * signers get DocuSign's email instead of signing in-app (hybrid model).
 *
 * Signing order is defined by the template itself; the role list here is a
 * read-only preview of who fills each role.
 */
import { useEffect, useState } from "react";
import { FileText, PenLine, Send, X } from "lucide-react";
import { useParticipants } from "@/hooks/useParticipants";
import {
  getContractPrep,
  listDocusignTemplates,
  saveContractFacts,
  saveContractTerms,
  sendTemplateForSignature,
  type ContractPrep,
  type DocusignTemplate,
  type TemplateAssignment,
} from "@/hooks/useDocuments";

type AgentInfo = { id: string; name: string; email: string };

// purchase_price -> "Purchase price"
function humanize(key: string): string {
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function SendTemplateModal({
  dealId,
  agent,
  onClose,
  onSent,
}: {
  dealId: string;
  agent: AgentInfo | null;
  onClose: () => void;
  onSent: (documentId: string | undefined) => void;
}) {
  const { participants } = useParticipants(dealId);
  const [templates, setTemplates] = useState<DocusignTemplate[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [formKey, setFormKey] = useState<string | null>(null);
  // Outside-signer inputs keyed by template roleName, for roles no participant fills.
  const [outside, setOutside] = useState<Record<string, { name: string; email: string }>>({});
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");

  // Contract-prep step (forms with a fieldMap): merged fields the agent
  // reviews/edits before the signers step. Values held as form strings;
  // checkboxes as booleans.
  const [step, setStep] = useState<"pick" | "prepare" | "signers">("pick");
  const [prep, setPrep] = useState<ContractPrep | null>(null);
  const [factVals, setFactVals] = useState<Record<string, string>>({});
  const [boardVals, setBoardVals] = useState<Record<string, string | boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listDocusignTemplates()
      .then((t) => {
        if (!cancelled) setTemplates(t);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLoadErr(e instanceof Error ? e.message : "Failed to load forms.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = templates?.find((t) => t.key === formKey) ?? null;

  // One row per template role: the matched deal person, or null → outside signer.
  const roleRows = selected
    ? Object.entries(selected.roleMapping).map(([participantRole, templateRole]) => {
        const person =
          participantRole === "agent"
            ? agent
              ? { ...agent, role: "agent" }
              : null
            : (participants.find((p) => p.role === participantRole) ?? null);
        return { participantRole, templateRole, person };
      })
    : [];

  const unfilled = roleRows.filter((r) => !r.person);
  const outsideValid = (templateRole: string) => {
    const o = outside[templateRole];
    return !!o && o.name.trim().length > 0 && o.email.includes("@");
  };
  const canSend =
    !!selected && !sending && unfilled.every((r) => outsideValid(r.templateRole));

  function setOutsideField(templateRole: string, field: "name" | "email", value: string) {
    setOutside((prev) => {
      const current = prev[templateRole] ?? { name: "", email: "" };
      return { ...prev, [templateRole]: { ...current, [field]: value } };
    });
  }

  function pickForm(t: DocusignTemplate) {
    setFormKey(t.key);
    setErr("");
    setPrep(null);
    if (Object.keys(t.fieldMap ?? {}).length > 0) {
      setStep("prepare");
      getContractPrep(dealId, t.key)
        .then((p) => {
          setPrep(p);
          const facts: Record<string, string> = {};
          for (const f of p.core) {
            if (f.type === "json") continue; // fixtures editor is v2
            facts[f.key] = f.value == null ? "" : String(f.value);
          }
          const board: Record<string, string | boolean> = {};
          for (const f of p.board_fields) {
            board[f.key] =
              f.type === "checkbox" ? f.value === true : f.value == null ? "" : String(f.value);
          }
          setFactVals(facts);
          setBoardVals(board);
        })
        .catch((e: unknown) => {
          setErr(e instanceof Error ? e.message : "Failed to load contract fields.");
        });
    } else {
      setStep("signers");
    }
  }

  async function handleSaveAndContinue() {
    if (!prep || !formKey) return;
    setSaving(true);
    setErr("");
    try {
      const facts: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(factVals)) {
        if (v !== "") facts[key] = v;
      }
      if (Object.keys(facts).length > 0) {
        await saveContractFacts(dealId, facts);
      }
      const terms: Record<string, unknown> = {};
      for (const f of prep.board_fields) {
        const v = boardVals[f.key];
        if (f.type === "checkbox") terms[f.key] = v === true;
        else if (v !== "" && v !== undefined) terms[f.key] = v;
      }
      if (Object.keys(terms).length > 0) {
        await saveContractTerms(dealId, formKey, terms);
      }
      setStep("signers");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to save contract fields.");
    }
    setSaving(false);
  }

  async function handleSend() {
    if (!selected) return;
    const assignments: TemplateAssignment[] = unfilled.map((r) => ({
      role_name: r.templateRole,
      email: outside[r.templateRole].email.trim(),
      name: outside[r.templateRole].name.trim(),
    }));
    setSending(true);
    setErr("");
    try {
      const res = await sendTemplateForSignature(dealId, selected.key, assignments);
      onSent(res.document?.id);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to send — check DocuSign configuration.");
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <PenLine size={16} className="text-brand-navy" />
            <h2 className="font-bold text-brand-navy text-sm">Send a Form for Signature</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {/* Form picker */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
              Choose a form
            </p>
            {loadErr ? (
              <p className="text-xs text-red-500">{loadErr}</p>
            ) : templates === null ? (
              <p className="text-xs text-gray-400">Loading forms…</p>
            ) : templates.length === 0 ? (
              <p className="text-xs text-gray-400">
                No standard forms configured yet — add templates to DOCUSIGN_TEMPLATES, or
                send a one-off document from the list below.
              </p>
            ) : (
              <div className="space-y-1.5">
                {templates.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => pickForm(t)}
                    className={[
                      "w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      formKey === t.key
                        ? "border-brand-navy bg-brand-navy/5"
                        : "border-gray-100 bg-white hover:bg-gray-50",
                    ].join(" ")}
                  >
                    <FileText size={14} className="text-gray-400 flex-shrink-0" />
                    <span className="flex-1 text-sm font-semibold text-brand-navy truncate">
                      {t.label}
                    </span>
                    <span className="text-[10px] font-bold uppercase text-gray-300">
                      {t.roles.join(" · ")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Contract prep — forms with a fieldMap */}
          {selected && step === "prepare" && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
                Prepare contract
              </p>
              {!prep ? (
                <p className="text-xs text-gray-400">Loading contract fields…</p>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    {prep.core
                      .filter((f) => f.type !== "json")
                      .map((f) => (
                        <div key={f.key} className="flex items-center gap-3">
                          <label
                            htmlFor={`fact-${f.key}`}
                            className="w-40 flex-shrink-0 text-xs font-semibold text-gray-500"
                          >
                            {humanize(f.key)}
                          </label>
                          <input
                            id={`fact-${f.key}`}
                            type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                            value={factVals[f.key] ?? ""}
                            onChange={(e) =>
                              setFactVals((prev) => ({ ...prev, [f.key]: e.target.value }))
                            }
                            className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:border-brand-navy focus:outline-none"
                          />
                        </div>
                      ))}
                  </div>
                  {prep.board_fields.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-300 mb-1.5">
                        {selected.board || "Form"} specifics
                      </p>
                      <div className="space-y-2">
                        {prep.board_fields.map((f) =>
                          f.type === "checkbox" ? (
                            <label key={f.key} className="flex items-center gap-2.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={boardVals[f.key] === true}
                                onChange={(e) =>
                                  setBoardVals((prev) => ({ ...prev, [f.key]: e.target.checked }))
                                }
                                className="h-4 w-4 rounded accent-brand-navy"
                              />
                              <span className="text-xs text-gray-600">{f.label ?? humanize(f.key)}</span>
                            </label>
                          ) : (
                            <div key={f.key} className="flex items-center gap-3">
                              <label
                                htmlFor={`term-${f.key}`}
                                className="w-40 flex-shrink-0 text-xs font-semibold text-gray-500"
                              >
                                {f.label ?? humanize(f.key)}
                              </label>
                              <input
                                id={`term-${f.key}`}
                                type="text"
                                value={String(boardVals[f.key] ?? "")}
                                onChange={(e) =>
                                  setBoardVals((prev) => ({ ...prev, [f.key]: e.target.value }))
                                }
                                className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:border-brand-navy focus:outline-none"
                              />
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}
                  <p className="text-[11px] text-gray-400">
                    These values prefill the contract — signers see them filled in. Leave a field
                    blank to leave it empty on the form.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Role assignment preview */}
          {selected && step === "signers" && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
                Signers
              </p>
              <div className="space-y-1.5">
                {roleRows.map((row, i) => (
                  <div
                    key={row.templateRole}
                    className="rounded-xl border border-gray-100 bg-white px-3 py-2.5"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand-navy/10 text-[10px] font-bold text-brand-navy">
                        {i + 1}
                      </span>
                      <span className="text-[10px] font-bold uppercase text-gray-300 w-14 flex-shrink-0">
                        {row.templateRole}
                      </span>
                      {row.person ? (
                        <>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-brand-navy truncate">
                              {row.person.name}
                            </p>
                            <p className="text-xs text-gray-400 truncate">{row.person.email}</p>
                          </div>
                          <span className="flex-shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                            Secure email link
                          </span>
                        </>
                      ) : (
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-amber-600 mb-1.5">
                            No {row.participantRole} on this deal — add an outside signer.
                          </p>
                          <div className="space-y-1.5">
                            <input
                              type="text"
                              placeholder="Signer name"
                              value={outside[row.templateRole]?.name ?? ""}
                              onChange={(e) =>
                                setOutsideField(row.templateRole, "name", e.target.value)
                              }
                              className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:border-brand-navy focus:outline-none"
                            />
                            <input
                              type="email"
                              placeholder="Signer email"
                              value={outside[row.templateRole]?.email ?? ""}
                              onChange={(e) =>
                                setOutsideField(row.templateRole, "email", e.target.value)
                              }
                              className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:border-brand-navy focus:outline-none"
                            />
                          </div>
                          {outsideValid(row.templateRole) && (
                            <p className="mt-1 text-[10px] font-bold text-blue-600">
                              Will get a DocuSign email
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-gray-400">
                Signing order and fields are set by the form template.
              </p>
            </div>
          )}

          {err && <p className="text-xs text-red-500">{err}</p>}
        </div>

        <div className="border-t px-5 py-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-500 hover:bg-gray-50"
          >
            Cancel
          </button>
          {step === "prepare" ? (
            <button
              onClick={handleSaveAndContinue}
              disabled={!prep || saving}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-brand-navy py-2.5 text-sm font-bold text-white hover:bg-brand-navy/90 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save & continue"}
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend || step !== "signers"}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-brand-navy py-2.5 text-sm font-bold text-white hover:bg-brand-navy/90 disabled:opacity-40"
            >
              <Send size={13} /> {sending ? "Sending…" : "Send"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
