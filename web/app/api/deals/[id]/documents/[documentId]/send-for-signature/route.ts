import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { loadDealPeople } from "@/lib/deals";
import { getDocusignClient, type DocusignSigner } from "@/lib/docusign";
import { deriveFallbackSigners, RoutingError } from "@/lib/docusign-routing";
import {
  recipientsFromSigners,
  sendDocumentEnvelope,
  type EnvelopeRecipient,
} from "@/lib/docusign-documents";
import { getObjectBytes } from "@/lib/s3";

type Ctx = { params: Promise<{ id: string; documentId: string }> };

type SendBody = {
  // Preferred: deal participants/agent by user id (routed buyer → seller →
  // agent, embedded signing via clientUserId).
  signer_user_ids?: string[];
  // Legacy / outside signers: raw email+name (DocuSign emails them).
  signers?: { email?: string; name?: string }[];
  // Optional marker for special documents ('' | 'baa').
  purpose?: string;
};

const PURPOSE_ALLOWLIST = ["", "baa"];

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
    if (body.purpose !== undefined && !PURPOSE_ALLOWLIST.includes(body.purpose)) {
      return error("invalid purpose", 400);
    }

    let signers: DocusignSigner[];
    let recipients: EnvelopeRecipient[];
    if (body.signer_user_ids && body.signer_user_ids.length > 0) {
      const people = await loadDealPeople(dealId);
      try {
        signers = deriveFallbackSigners(people, body.signer_user_ids);
      } catch (err) {
        if (err instanceof RoutingError) return error(err.message, 400);
        throw err;
      }
      recipients = recipientsFromSigners(signers, people);
    } else {
      signers = (body.signers ?? [])
        .filter((s): s is { email: string; name: string } => !!s.email && !!s.name)
        .map((s) => ({ email: s.email, name: s.name }));
      if (signers.length === 0) {
        return error("at least one signer required", 400);
      }
      recipients = recipientsFromSigners(signers);
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
        recipients,
        purpose: body.purpose,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return error("failed to create envelope: " + msg, 502);
    }

    return json({ envelope_id: envelopeId, status: "sent" });
  })) as Response;
}
