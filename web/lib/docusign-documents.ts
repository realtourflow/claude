/**
 * Shared DocuSign send path for deal documents — used by the single-document
 * send-for-signature route and the disclosure-packet route.
 *
 * Creates ONE envelope for the given bytes and stamps the envelope id /
 * "sent" status onto the documents row, so the existing webhook
 * (/api/docusign/webhook) and document status tags track it from there.
 *
 * Throws when envelope creation fails — the caller decides how to clean up
 * (the single-doc route just reports 502; the packet route also removes the
 * row it created).
 */
import { prisma } from "./db";
import { getDocusignClient, type DocusignSigner } from "./docusign";

export async function sendDocumentEnvelope(input: {
  documentId: string;
  docName: string;
  bytes: Uint8Array;
  signers: DocusignSigner[];
}): Promise<{ envelopeId: string; sentAt: Date }> {
  const docusign = getDocusignClient();
  const envelopeId = await docusign.createEnvelope(
    input.docName,
    input.bytes,
    input.signers
  );

  const sentAt = new Date();
  await prisma.documents.update({
    where: { id: input.documentId },
    data: {
      docusign_envelope_id: envelopeId,
      docusign_status: "sent",
      docusign_sent_at: sentAt,
    },
  });
  return { envelopeId, sentAt };
}
