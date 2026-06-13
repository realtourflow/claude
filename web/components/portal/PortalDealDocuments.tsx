"use client";

/**
 * Shared buyer/seller portal documents tab: agent form templates + real deal
 * documents with e-sign status, the embedded "Sign this document" entry point,
 * and the post-signing return flow.
 *
 * Embedded signing (Stage 2): when the viewer is a pending signer on a
 * document's envelope (my_recipient_status sent/delivered), the Sign button
 * mints a single-use recipient-view URL and full-page-redirects into DocuSign.
 * DocuSign returns to the portal with ?signed_doc=<id>&event=signing_complete,
 * which triggers an immediate status refresh (instant feedback even before the
 * webhook lands). Outside signers and pre-embedded envelopes sign via their
 * DocuSign email instead — the signing-url route 409s with an inbox hint.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, FileText, Loader2, PenLine } from "lucide-react";
import { useAgentDocTemplatesForDeal, DOC_TYPE_LABELS } from "@/hooks/useAgentDocs";
import {
  useDocuments,
  getDownloadUrl as getDealDocDownloadUrl,
  getSigningUrl,
  refreshDocuSignStatus,
  type Document as DealDocument,
} from "@/hooks/useDocuments";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  sent: { label: "Awaiting signatures", cls: "bg-blue-100 text-blue-700" },
  delivered: { label: "Viewed", cls: "bg-indigo-100 text-indigo-700" },
  completed: { label: "Signed", cls: "bg-green-100 text-green-700" },
  declined: { label: "Declined", cls: "bg-red-100 text-red-700" },
  voided: { label: "Voided", cls: "bg-gray-100 text-gray-500" },
};

const SIGNABLE = ["sent", "delivered"];

function cameFromSigning(): { docId: string } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const docId = params.get("signed_doc");
  if (docId && params.get("event") === "signing_complete") return { docId };
  return null;
}

export default function PortalDealDocuments({ dealId }: { dealId: string }) {
  const { templates, loading: tLoading, getDownloadUrl: getTemplateUrl } =
    useAgentDocTemplatesForDeal(dealId);
  const { docs, loading: dLoading, refresh } = useDocuments(dealId);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [signingId, setSigningId] = useState<string | null>(null);
  const [signErr, setSignErr] = useState("");
  // Lazy initializer (not an effect) so the banner shows on the first render
  // after returning from DocuSign without a set-state-in-effect.
  const [signedReturn] = useState(cameFromSigning);

  useEffect(() => {
    if (!signedReturn) return;
    // Instant feedback ahead of the webhook: pull the latest status, then
    // refetch the list. Best-effort — the webhook/self-heal also covers it.
    refreshDocuSignStatus(dealId, signedReturn.docId)
      .catch(() => {})
      .finally(() => refresh());
    // Strip the params so reloads don't repeat this.
    window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount
  }, []);

  async function handleDownload(id: string, isTemplate: boolean) {
    setDownloading(id);
    try {
      const url = isTemplate ? await getTemplateUrl(id) : await getDealDocDownloadUrl(id);
      window.open(url, "_blank");
    } catch {
      // ignore
    } finally {
      setDownloading(null);
    }
  }

  async function handleSign(doc: DealDocument) {
    setSigningId(doc.id);
    setSignErr("");
    try {
      const url = await getSigningUrl(dealId, doc.id);
      window.location.assign(url);
    } catch (e: unknown) {
      setSignErr(e instanceof Error ? e.message : "Could not start signing — try again.");
      setSigningId(null);
    }
  }

  if (tLoading || dLoading) {
    return <div className="py-6 text-center text-sm text-gray-400">Loading documents…</div>;
  }

  if (templates.length === 0 && docs.length === 0 && !signedReturn) {
    return (
      <div className="rounded-xl bg-white px-4 py-8 text-center text-sm text-gray-400">
        No documents yet — your agent will share forms here.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {signedReturn && (
        <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
          <CheckCircle2 size={15} className="text-green-500 flex-shrink-0" />
          <p className="text-sm font-semibold text-green-800">
            Signature recorded — thank you! Status updates below as everyone signs.
          </p>
        </div>
      )}
      {signErr && <p className="text-xs text-red-500">{signErr}</p>}

      {templates.length > 0 && (
        <section>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">Agent Forms</p>
          <div className="space-y-2">
            {templates.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-xl bg-white border border-gray-100 px-4 py-3">
                <FileText size={16} className="flex-shrink-0 text-gray-300" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-brand-navy truncate">{t.name}</p>
                  <p className="text-[11px] text-gray-400">{DOC_TYPE_LABELS[t.docType] ?? t.docType}</p>
                </div>
                <button
                  onClick={() => handleDownload(t.id, true)}
                  disabled={downloading === t.id}
                  className="flex items-center gap-1 rounded-lg bg-brand-navy/5 px-2.5 py-1 text-xs font-semibold text-brand-navy hover:bg-brand-navy/10 disabled:opacity-50 transition-colors"
                >
                  {downloading === t.id ? <Loader2 size={11} className="animate-spin" /> : <ExternalLink size={11} />}
                  Open
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {docs.length > 0 && (
        <section>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">Deal Documents</p>
          <div className="space-y-2">
            {docs.map((d) => {
              const meta = d.docusignStatus ? STATUS_META[d.docusignStatus] : null;
              const canSign =
                !!d.myRecipientStatus && SIGNABLE.includes(d.myRecipientStatus);
              return (
                <div key={d.id} className="flex items-center gap-3 rounded-xl bg-white border border-gray-100 px-4 py-3">
                  <FileText size={16} className="flex-shrink-0 text-gray-300" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-sm font-medium text-brand-navy truncate">{d.name}</p>
                      {meta && (
                        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${meta.cls}`}>
                          {meta.label}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400">
                      {new Date(d.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                  {canSign && (
                    <button
                      onClick={() => handleSign(d)}
                      disabled={signingId === d.id}
                      className="flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-navy/90 disabled:opacity-50 transition-colors"
                    >
                      {signingId === d.id ? <Loader2 size={11} className="animate-spin" /> : <PenLine size={11} />}
                      Sign this document
                    </button>
                  )}
                  <button
                    onClick={() => handleDownload(d.id, false)}
                    disabled={downloading === d.id}
                    className="flex items-center gap-1 rounded-lg bg-brand-navy/5 px-2.5 py-1 text-xs font-semibold text-brand-navy hover:bg-brand-navy/10 disabled:opacity-50 transition-colors"
                  >
                    {downloading === d.id ? <Loader2 size={11} className="animate-spin" /> : <ExternalLink size={11} />}
                    Open
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
