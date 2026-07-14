"use client";

import { useState, useEffect } from "react";
import { Deal } from "@/lib/data/mockDeals";
import { useAuthStore } from "@/lib/store/authStore";
import { requestUploadUrl, confirmUpload, getDownloadUrl, deleteDocument, sendForSignatureByUserIds, getSigningUrl, refreshDocuSignStatus, setDisclosuresComplete, Document as ApiDocument } from "@/hooks/useDocuments";
import { uploadFileToStorage } from "@/lib/direct-upload";
import { useParticipants } from "@/hooks/useParticipants";
import SendTemplateModal from "@/components/pages/agent/SendTemplateModal";
import { CheckCircle2, Loader2, FileText, RefreshCw, Plus, X, AlertTriangle, PenLine, Send, Download, Trash2, Check } from "lucide-react";
import { STAGE_GATE } from "@/components/deal/shared";

// ── Upload Modal ──────────────────────────────────────────────────────────────

const DOC_TYPE_OPTIONS = [
  'Buyer Agency Agreement',
  'Purchase Agreement',
  'Listing Agreement',
  'Seller Disclosures',
  'Inspection Report',
  'Repair Addendum',
  'Wire Instructions',
  'ARIVE Disclosures',
  'Proof of Funds',
  'Appraisal Report',
  'Title Commitment',
  'HOA Documents',
  'Other',
];

// Exported for tests (tests/components/DealDetail.test.tsx).
export function UploadDocModal({
  dealId,
  onClose,
  onUploaded,
}: {
  dealId: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [name, setName] = useState(DOC_TYPE_OPTIONS[0]);
  const [customName, setCustomName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const effectiveName = name === 'Other' ? customName.trim() : name;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveName || !file) return;
    setUploading(true);
    setError(null);
    try {
      const mimeType = file.type || 'application/octet-stream';
      const { upload_url, client_upload_url, s3_key } = await requestUploadUrl(dealId, file.name, mimeType);
      // #189: bytes go browser → Blob via the presigned grant when available
      // (a Vercel Function caps request bodies at ~4.5MB, so 4.5–25MB files
      // can never pass through the proxy in prod); the proxy remains the
      // fallback. A failed upload must never confirm — that would create a
      // phantom documents row that 404s on download (#190).
      const put = await uploadFileToStorage({
        uploadUrl: upload_url,
        clientUploadUrl: client_upload_url,
        key: s3_key,
        file,
        contentType: mimeType,
      });
      if (!put.ok) {
        setError(put.tooLarge ? 'File too large (max 25MB).' : 'Upload failed. Please try again.');
        return;
      }
      await confirmUpload(dealId, effectiveName, s3_key, mimeType, file.size);
      setDone(true);
      onUploaded();
    } catch {
      setError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
        <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-8 text-center">
          <CheckCircle2 size={40} className="mx-auto mb-3 text-green-400" />
          <p className="font-bold text-brand-navy mb-1">Document uploaded</p>
          <p className="text-sm text-gray-500 mb-5">
            <span className="font-semibold">{effectiveName}</span> is now saved to this deal.
          </p>
          <button onClick={onClose} className="w-full rounded-xl bg-brand-navy py-2.5 text-sm font-bold text-white hover:bg-brand-navy/90 transition-colors">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-bold text-brand-navy">Upload Document</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100 transition-colors">
            <X size={16} className="text-gray-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Document Type</label>
            <select
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-brand-navy outline-none focus:border-brand-navy/30"
            >
              {DOC_TYPE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          {name === 'Other' && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">Custom Name</label>
              <input
                required
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Document name"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-brand-navy outline-none focus:border-brand-navy/30"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">File</label>
            <div className="flex items-center gap-3 rounded-xl border-2 border-dashed border-gray-200 px-4 py-5 bg-gray-50 hover:border-brand-navy/30 transition-colors">
              <FileText size={20} className="text-gray-300 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                {file ? (
                  <p className="text-sm font-medium text-brand-navy truncate">{file.name}</p>
                ) : (
                  <p className="text-sm text-gray-400">Click to select a file</p>
                )}
              </div>
              <label className="cursor-pointer rounded-lg bg-white border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition-colors">
                Browse
                <input
                  type="file"
                  className="sr-only"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
          </div>
          {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!file || !effectiveName || uploading}
              className="flex-1 rounded-xl bg-brand-navy py-2.5 text-sm font-bold text-white hover:bg-brand-navy/80 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {uploading ? <><Loader2 size={14} className="animate-spin" /> Uploading…</> : 'Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocIcon({ mimeType }: { mimeType: string }) {
  if (mimeType === 'application/pdf') return <FileText size={16} className="text-red-400 flex-shrink-0" />;
  if (mimeType.startsWith('image/')) return <FileText size={16} className="text-blue-400 flex-shrink-0" />;
  if (mimeType.includes('word') || mimeType.includes('document')) return <FileText size={16} className="text-blue-600 flex-shrink-0" />;
  return <FileText size={16} className="text-gray-400 flex-shrink-0" />;
}

const DOCUSIGN_STATUS_META: Record<string, { label: string; cls: string }> = {
  sent:      { label: 'Sent for signature', cls: 'bg-blue-100 text-blue-700' },
  delivered: { label: 'Viewed',             cls: 'bg-indigo-100 text-indigo-700' },
  completed: { label: 'Signed',             cls: 'bg-green-100 text-green-700' },
  declined:  { label: 'Declined',           cls: 'bg-red-100 text-red-700' },
  voided:    { label: 'Voided',             cls: 'bg-gray-100 text-gray-500' },
};

// The viewer's own recipient statuses that still allow embedded signing —
// mirrors the portal (PortalDealDocuments). Templates route the owning agent
// as an embedded recipient (clientUserId, no DocuSign email), so the agent
// signs from here, exactly like buyers/sellers sign from their portal (#165).
const MY_SIGNABLE_STATUSES = ['sent', 'delivered'];

// DocuSign returns the agent to /agent/deals/[dealId]?signed_doc=<id>&
// event=signing_complete (the signing-url route's returnUrl).
function cameFromSigning(): { docId: string } | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const docId = params.get('signed_doc');
  if (docId && params.get('event') === 'signing_complete') return { docId };
  return null;
}

function SendForSignatureModal({
  doc,
  dealId,
  onClose,
  onSent,
}: {
  doc: ApiDocument;
  dealId: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const { participants } = useParticipants(dealId);
  const signable = participants.filter((p) => p.role === 'buyer' || p.role === 'seller');
  const [selected, setSelected] = useState<Set<string>>(new Set(signable.map((p) => p.id)));
  const [isBaa, setIsBaa] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');

  // Server routing policy: buyers sign first, then sellers. Mirrored here so
  // the modal can preview the order read-only.
  const orderOf = (role: string) => (role === 'buyer' ? 1 : 2);
  const selectedOrdered = signable
    .filter((p) => selected.has(p.id))
    .sort((a, b) => orderOf(a.role) - orderOf(b.role));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSend() {
    const ids = selectedOrdered.map((p) => p.id);
    if (ids.length === 0) { setErr('Select at least one signer.'); return; }
    setSending(true);
    setErr('');
    try {
      await sendForSignatureByUserIds(dealId, doc.id, ids, isBaa ? 'baa' : undefined);
      onSent();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to send — check DocuSign configuration.');
    }
    setSending(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <PenLine size={16} className="text-brand-navy" />
            <h2 className="font-bold text-brand-navy text-sm">Send for Signature</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <FileText size={13} className="text-gray-400 flex-shrink-0" />
              <span className="text-sm font-semibold text-brand-navy truncate">{doc.name}</span>
            </div>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Select signers</p>
            {signable.length === 0 ? (
              <p className="text-xs text-gray-400">No buyers or sellers on this deal yet.</p>
            ) : (
              <div className="space-y-1.5">
                {signable.map((p) => {
                  const orderIdx = selectedOrdered.findIndex((s) => s.id === p.id);
                  return (
                    <label key={p.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggle(p.id)}
                        className="h-4 w-4 rounded accent-brand-navy"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-brand-navy truncate">{p.name}</p>
                        <p className="text-xs text-gray-400 truncate">{p.email}</p>
                      </div>
                      {orderIdx >= 0 && (
                        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand-navy/10 text-[10px] font-bold text-brand-navy" title="Signing order">
                          {orderIdx + 1}
                        </span>
                      )}
                      <span className="text-[10px] font-bold uppercase text-gray-300">{p.role}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {signable.length > 0 && (
              <p className="mt-2 text-[11px] text-gray-400">Buyers sign first, then sellers.</p>
            )}
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={isBaa}
              onChange={(e) => setIsBaa(e.target.checked)}
              className="h-4 w-4 rounded accent-brand-navy"
            />
            <span className="text-xs text-gray-600">
              This is the buyer agency agreement
            </span>
          </label>

          {err && <p className="text-xs text-red-500">{err}</p>}
        </div>
        <div className="border-t px-5 py-4 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-500 hover:bg-gray-50">Cancel</button>
          <button
            onClick={handleSend}
            disabled={sending || selected.size === 0}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-brand-navy py-2.5 text-sm font-bold text-white hover:bg-brand-navy/90 disabled:opacity-40"
          >
            <Send size={13} /> {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Exported for tests (tests/components/deal-detail-documents-sign.test.tsx).
export function DocumentsTab({
  deal,
  docs,
  loading,
  onRefresh,
}: {
  deal: Deal;
  docs: ApiDocument[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const [showUpload, setShowUpload] = useState(false);
  const [showSendForm, setShowSendForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [signingDoc, setSigningDoc] = useState<ApiDocument | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  // The agent's OWN embedded signing (they're a routed recipient on the
  // envelope — e.g. BAA / listing agreements). Mirrors PortalDealDocuments.
  const [mintingSignId, setMintingSignId] = useState<string | null>(null);
  const [signErr, setSignErr] = useState('');
  // Lazy initializer (not an effect) so the banner shows on the first render
  // after returning from DocuSign without a set-state-in-effect.
  const [signedReturn] = useState(cameFromSigning);
  // Agent info previews the agent's own role row in the template modal.
  const activeUser = useAuthStore((s) => s.activeUser);
  // Disclosures are tracked, never sent from RTF — the lender delivers them
  // out-of-band (ARIVE will feed this in v2). Manual toggle for now.
  const [disclosuresDone, setDisclosuresDone] = useState(deal.disclosuresComplete ?? false);
  const [disclosuresSaving, setDisclosuresSaving] = useState(false);

  useEffect(() => {
    if (!signedReturn) return;
    // Instant feedback ahead of the webhook: pull the latest status, then
    // refetch the list. Best-effort — the webhook/self-heal also covers it.
    refreshDocuSignStatus(deal.id ?? '', signedReturn.docId)
      .catch(() => {})
      .finally(() => onRefresh());
    // Strip the params so reloads don't repeat this.
    window.history.replaceState(null, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount
  }, []);

  async function handleSelfSign(doc: ApiDocument) {
    setMintingSignId(doc.id);
    setSignErr('');
    try {
      const url = await getSigningUrl(deal.id ?? '', doc.id);
      window.location.assign(url);
    } catch (e: unknown) {
      setSignErr(e instanceof Error ? e.message : 'Could not start signing — try again.');
      setMintingSignId(null);
    }
  }

  async function toggleDisclosures(next: boolean) {
    setDisclosuresSaving(true);
    try {
      await setDisclosuresComplete(deal.id ?? '', next);
      setDisclosuresDone(next);
    } catch {
      // leave the previous state; user can retry
    } finally {
      setDisclosuresSaving(false);
    }
  }

  const stageReq = STAGE_GATE[deal.stage];
  const stageDocFound = stageReq ? docs.some((d) => d.name === stageReq.name) : false;

  async function handleDownload(doc: ApiDocument) {
    setDownloadingId(doc.id);
    try {
      const url = await getDownloadUrl(doc.id);
      window.open(url, '_blank');
    } catch {
      // silently fail — user sees nothing happened, can retry
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleDelete(doc: ApiDocument) {
    if (!confirm(`Delete "${doc.name}"? This cannot be undone.`)) return;
    setDeletingId(doc.id);
    try {
      await deleteDocument(doc.id);
      onRefresh();
    } catch {
      // silently fail
    } finally {
      setDeletingId(null);
    }
  }

  async function handleRefreshStatus(doc: ApiDocument) {
    setRefreshingId(doc.id);
    try {
      await refreshDocuSignStatus(deal.id ?? '', doc.id);
      onRefresh();
    } catch {}
    setRefreshingId(null);
  }

  return (
    <div className="space-y-3">
      {stageReq && (
        <div className={`flex items-start gap-3 rounded-xl px-4 py-3 border ${
          stageDocFound ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
        }`}>
          {stageDocFound
            ? <CheckCircle2 size={15} className="text-green-600 flex-shrink-0 mt-0.5" />
            : <AlertTriangle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />}
          <div>
            <p className={`text-xs font-bold ${stageDocFound ? 'text-green-800' : 'text-amber-800'}`}>
              Stage requirement: {stageReq.name}
            </p>
            <p className={`text-[11px] mt-0.5 ${stageDocFound ? 'text-green-600' : 'text-amber-600'}`}>
              {stageDocFound ? 'Uploaded ✓' : stageReq.note}
            </p>
          </div>
        </div>
      )}

      {signedReturn && (
        <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
          <CheckCircle2 size={15} className="text-green-500 flex-shrink-0" />
          <p className="text-sm font-semibold text-green-800">
            Signature recorded — status updates below as everyone signs.
          </p>
        </div>
      )}
      {signErr && <p className="text-xs text-red-500">{signErr}</p>}

      <div className="rounded-xl bg-white shadow-sm overflow-hidden">
        <div className="divide-y">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-5 py-8 text-sm text-gray-400">
              <Loader2 size={15} className="animate-spin" /> Loading…
            </div>
          ) : docs.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <FileText size={28} className="mx-auto mb-2 text-gray-200" />
              <p className="text-sm text-gray-400">No documents yet</p>
              <p className="text-xs text-gray-300 mt-0.5">Upload the first one below</p>
            </div>
          ) : (
            docs.map((doc) => {
              const dsStatus = doc.docusignStatus;
              const dsMeta = dsStatus ? DOCUSIGN_STATUS_META[dsStatus] : null;
              return (
                <div key={doc.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-brand-bg transition-colors group">
                  <DocIcon mimeType={doc.mimeType} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-sm font-medium text-brand-navy truncate">{doc.name}</div>
                      {dsMeta ? (
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold flex-shrink-0 ${dsMeta.cls}`}>
                          {dsStatus === 'completed' && <Check size={12} strokeWidth={3} />}
                          {dsMeta.label}
                        </span>
                      ) : (
                        <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold flex-shrink-0 bg-gray-100 text-gray-500">
                          Unsigned
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {doc.uploaderName} · {formatFileSize(doc.fileSize)} · {new Date(doc.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {/* The agent is a routed embedded signer on this envelope
                        and hasn't signed yet — mint their recipient view */}
                    {!!doc.myRecipientStatus && MY_SIGNABLE_STATUSES.includes(doc.myRecipientStatus) && (
                      <button
                        onClick={() => handleSelfSign(doc)}
                        disabled={mintingSignId === doc.id}
                        title="Sign this document"
                        className="flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-navy/90 disabled:opacity-50 transition-colors"
                      >
                        {mintingSignId === doc.id
                          ? <Loader2 size={11} className="animate-spin" />
                          : <PenLine size={11} />}
                        Sign
                      </button>
                    )}
                    {/* Send for Signature — only if not already sent or completed */}
                    {(!dsStatus || dsStatus === 'declined' || dsStatus === 'voided') && (
                      <button
                        onClick={() => setSigningDoc(doc)}
                        title="Send for Signature"
                        className="rounded-lg p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                      >
                        <Send size={36} />
                      </button>
                    )}
                    {/* Refresh DocuSign status */}
                    {dsStatus && dsStatus !== 'completed' && (
                      <button
                        onClick={() => handleRefreshStatus(doc)}
                        disabled={refreshingId === doc.id}
                        title="Refresh signature status"
                        className="rounded-lg p-2 text-gray-500 hover:text-brand-navy hover:bg-gray-100 transition-colors disabled:opacity-40"
                      >
                        {refreshingId === doc.id
                          ? <Loader2 size={36} className="animate-spin" />
                          : <RefreshCw size={36} />}
                      </button>
                    )}
                    <button
                      onClick={() => handleDownload(doc)}
                      disabled={downloadingId === doc.id}
                      title="Download"
                      className="rounded-lg p-2 text-gray-500 hover:text-brand-navy hover:bg-gray-100 transition-colors disabled:opacity-40"
                    >
                      {downloadingId === doc.id
                        ? <Loader2 size={36} className="animate-spin" />
                        : <Download size={36} />}
                    </button>
                    <button
                      onClick={() => handleDelete(doc)}
                      disabled={deletingId === doc.id}
                      title="Delete"
                      className="rounded-lg p-2 text-gray-500 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                    >
                      {deletingId === doc.id
                        ? <Loader2 size={36} className="animate-spin" />
                        : <Trash2 size={36} />}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="border-t px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4 flex-wrap">
            <button
              onClick={() => setShowSendForm(true)}
              className="flex items-center gap-1.5 text-sm font-semibold text-brand-navy hover:text-brand-navy/70 transition-colors"
            >
              <PenLine size={14} /> Send a form
            </button>
            <button
              onClick={() => setShowUpload(true)}
              className="flex items-center gap-1.5 text-sm font-medium text-brand-navy hover:text-brand-navy/70 transition-colors"
            >
              <Plus size={14} /> Upload Document
            </button>
            <label className="flex items-center gap-1.5 cursor-pointer text-sm text-gray-500">
              <input
                type="checkbox"
                checked={disclosuresDone}
                disabled={disclosuresSaving}
                onChange={(e) => toggleDisclosures(e.target.checked)}
                className="h-3.5 w-3.5 rounded accent-brand-navy"
              />
              Disclosures complete
              <span className="text-[10px] text-gray-300">(lender sends these)</span>
            </label>
          </div>
          <button
            onClick={onRefresh}
            className="rounded-lg p-1.5 hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {showUpload && (
        <UploadDocModal
          dealId={deal.id ?? ''}
          onClose={() => setShowUpload(false)}
          onUploaded={() => { setShowUpload(false); onRefresh(); }}
        />
      )}

      {signingDoc && (
        <SendForSignatureModal
          doc={signingDoc}
          dealId={deal.id ?? ''}
          onClose={() => setSigningDoc(null)}
          onSent={() => { setSigningDoc(null); onRefresh(); }}
        />
      )}

      {showSendForm && (
        <SendTemplateModal
          dealId={deal.id ?? ''}
          agent={
            activeUser
              ? { id: activeUser.id, name: activeUser.name, email: activeUser.email }
              : null
          }
          onClose={() => setShowSendForm(false)}
          onSent={() => { setShowSendForm(false); onRefresh(); }}
        />
      )}
    </div>
  );
}

// ─── Vendors Tab ─────────────────────────────────────────────────────────────

// ── Add/Edit Contact Modal ────────────────────────────────────────────────────
