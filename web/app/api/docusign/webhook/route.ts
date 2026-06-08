import { prisma } from "@/lib/db";
import { json } from "@/lib/http";

type WebhookPayload = {
  event?: string;
  data?: {
    envelopeId?: string;
    envelopeSummary?: { status?: string };
  };
};

// POST /api/docusign/webhook — public (registered in DocuSign Connect).
// Ports DocuSignWebhook in backend/internal/handlers/docusign.go.
// Always returns 200 so DocuSign does not retry, even on a bad payload.
export async function POST(req: Request): Promise<Response> {
  let payload: WebhookPayload;
  try {
    payload = (await req.json()) as WebhookPayload;
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
