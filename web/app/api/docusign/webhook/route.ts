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
// When DOCUSIGN_CONNECT_HMAC_KEY is set, the request must carry a valid
// X-DocuSign-Signature-* header (HMAC-SHA256 over the raw body) — a forged or
// unsigned callback is rejected with 401 and never touches the database. With
// no key configured the handler trusts the POST (legacy/demo). On an accepted
// call it updates document + recipient statuses, archives the signed PDF on
// completion (awaited — fire-and-forget dies on Vercel), and returns 200 so
// DocuSign does not retry, even when the payload is unparseable or incomplete.
export async function POST(req: Request): Promise<Response> {
  // Read the raw body first — the HMAC is computed over the exact bytes, so we
  // must verify against the raw text, not a re-serialized parse.
  const raw = await req.text();

  const hmacKey = env().DOCUSIGN_CONNECT_HMAC_KEY;
  if (hmacKey && !verifyDocusignSignature(raw, req.headers, hmacKey)) {
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
