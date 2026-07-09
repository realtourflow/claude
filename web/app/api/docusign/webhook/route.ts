import { prisma } from "@/lib/db";
import { error, json } from "@/lib/http";
import { env } from "@/lib/env";
import { verifyDocusignSignature } from "@/lib/docusign-webhook";
import {
  handleEnvelopeCompleted,
  syncRecipientStatuses,
} from "@/lib/docusign-archive";

type WebhookSigner = {
  email?: string;
  status?: string;
  recipientId?: string;
};

type WebhookPayload = {
  event?: string;
  data?: {
    envelopeId?: string;
    envelopeSummary?: {
      status?: string;
      recipients?: { signers?: WebhookSigner[] };
    };
  };
};

// POST /api/docusign/webhook — public (DocuSign envelope eventNotification).
//
// Signature enforcement is fail-closed (#176). Verification of the
// X-DocuSign-Signature-* header (HMAC-SHA256 over the raw body) is required
// whenever ANY of these hold:
//   - DOCUSIGN_CONNECT_HMAC_KEY is set (verify against it), or
//   - DOCUSIGN_WEBHOOK_URL is set (the webhook is live somewhere real), or
//   - VERCEL_ENV=production.
// In the last two cases a missing key means every POST is rejected with 401 —
// never trusted. (env() itself also refuses to parse in production without
// the key; that throw is treated as a rejection here, not a 500.) Only in
// local dev/CI/demo — no key, webhook not live, not production — does the
// handler trust an unsigned POST. On an accepted call it updates document +
// recipient statuses, archives the signed PDF on completion (awaited —
// fire-and-forget dies on Vercel), and returns 200 so DocuSign does not
// retry, even when the payload is unparseable or incomplete.
export async function POST(req: Request): Promise<Response> {
  // Read the raw body first — the HMAC is computed over the exact bytes, so we
  // must verify against the raw text, not a re-serialized parse.
  const raw = await req.text();

  let hmacKey: string;
  let enforceSignature: boolean;
  try {
    const cfg = env();
    hmacKey = cfg.DOCUSIGN_CONNECT_HMAC_KEY;
    enforceSignature =
      hmacKey !== "" ||
      cfg.DOCUSIGN_WEBHOOK_URL !== "" ||
      cfg.VERCEL_ENV === "production";
  } catch {
    // env() fails closed (e.g. DOCUSIGN_CONNECT_HMAC_KEY missing in
    // production) — an unverifiable request must be rejected, not trusted.
    return error("invalid docusign signature", 401);
  }

  if (enforceSignature && !verifyDocusignSignature(raw, req.headers, hmacKey)) {
    return error("invalid docusign signature", 401);
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(raw) as WebhookPayload;
  } catch {
    return json({ ok: true });
  }

  const envelopeId = payload.data?.envelopeId ?? "";
  const status = payload.data?.envelopeSummary?.status ?? "";
  if (!envelopeId) return json({ ok: true });

  if (status) {
    await prisma.documents.updateMany({
      where: { docusign_envelope_id: envelopeId },
      data: { docusign_status: status },
    });
  }

  const signers = payload.data?.envelopeSummary?.recipients?.signers ?? [];
  if (signers.length > 0) {
    await syncRecipientStatuses(envelopeId, signers);
  }

  if (status === "completed" || payload.event === "envelope-completed") {
    await handleEnvelopeCompleted(envelopeId);
  }

  return json({ ok: true });
}
