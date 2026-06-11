import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { getDocusignClient, type DocusignSigner } from "@/lib/docusign";
import { sendDocumentEnvelope } from "@/lib/docusign-documents";
import { getObjectBytes } from "@/lib/s3";

type Ctx = { params: Promise<{ id: string; documentId: string }> };

type SendBody = {
  signers?: { email?: string; name?: string }[];
};

// POST /api/deals/[id]/documents/[documentId]/send-for-signature
// Ports SendForSignature in the legacy Go backend.
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId, documentId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    // Only the owning agent may send a document for signature.
    const owned = await prisma.deals.findFirst({
      where: { id: dealId, agent_id: userId },
      select: { id: true },
    });
    if (!owned) return error("deal not found or access denied", 404);

    const docusign = getDocusignClient();
    if (!docusign.enabled()) {
      return error("DocuSign not configured", 503);
    }

    const doc = await prisma.documents.findFirst({
      where: { id: documentId, deal_id: dealId },
      select: { name: true, s3_key: true },
    });
    if (!doc) return error("document not found", 404);

    let body: SendBody;
    try {
      body = (await req.json()) as SendBody;
    } catch {
      return error("at least one signer required", 400);
    }
    const signers: DocusignSigner[] = (body.signers ?? [])
      .filter((s): s is { email: string; name: string } => !!s.email && !!s.name)
      .map((s) => ({ email: s.email, name: s.name }));
    if (signers.length === 0) {
      return error("at least one signer required", 400);
    }

    let bytes: Uint8Array;
    try {
      bytes = await getObjectBytes(doc.s3_key);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return error("failed to retrieve document: " + msg, 500);
    }

    let envelopeId: string;
    try {
      ({ envelopeId } = await sendDocumentEnvelope({
        documentId,
        docName: doc.name,
        bytes,
        signers,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return error("failed to create envelope: " + msg, 502);
    }

    return json({ envelope_id: envelopeId, status: "sent" });
  })) as Response;
}
