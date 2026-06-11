import { prisma } from "@/lib/db";
import { error, json } from "@/lib/http";
import { env } from "@/lib/env";
import { verifyDocusignSignature } from "@/lib/docusign-webhook";

type WebhookPayload = {
  event?: string;
  data?: {
    envelopeId?: string;
    envelopeSummary?: { status?: string };
  };
};

// POST /api/docusign/webhook — public (registered in DocuSign Connect).
// Ports DocuSignWebhook in the legacy Go backend.
//
// When DOCUSIGN_CONNECT_HMAC_KEY is set, the request must carry a valid
// X-DocuSign-Signature-* header (HMAC-SHA256 over the raw body) — a forged or
// unsigned callback is rejected with 401 and never touches the database. With no
// key configured the handler trusts the POST (legacy/demo). On an accepted call
// it updates the matching document's status and returns 200 so DocuSign does not
// retry, even when the payload is unparseable or incomplete.
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
  if (envelopeId && status) {
    await prisma.documents.updateMany({
      where: { docusign_envelope_id: envelopeId },
      data: { docusign_status: status },
    });
  }

  return json({ ok: true });
}
