/**
 * Signed-PDF archival: when an envelope completes, pull the combined signed
 * PDF from DocuSign and store it in S3, linked on the documents row
 * (docusign_signed_s3_key). For template sends this is the document's ONLY
 * artifact — the row was created as a placeholder (s3_key='').
 *
 * Idempotent: a second call (duplicate webhook delivery, refresh self-heal
 * racing the webhook) is a no-op once the signed key is set. Never throws —
 * callers hold a 200 contract with DocuSign (the webhook) or already returned
 * the status (refresh); a failed archive logs and self-heals on the next
 * refresh/webhook retry.
 */
import { prisma } from "./db";
import { getDocusignClient } from "./docusign";
import { makeS3Key, putObjectBytes } from "./s3";

/**
 * Sync per-recipient statuses onto docusign_recipients rows. Matched by
 * envelope + email (case-insensitive), NEVER by recipientId — template sends
 * store a local ordinal that doesn't match DocuSign's assigned ids. Used by
 * both the webhook (event payload recipients) and the refresh self-heal
 * (authoritative listRecipients).
 */
export async function syncRecipientStatuses(
  envelopeId: string,
  signers: { email?: string; status?: string }[]
): Promise<void> {
  for (const s of signers) {
    if (!s.email || !s.status) continue;
    await prisma.$executeRaw`
      UPDATE docusign_recipients
      SET status = ${s.status},
          signed_at = CASE
            WHEN ${s.status} = 'completed' AND signed_at IS NULL THEN now()
            ELSE signed_at
          END
      WHERE envelope_id = ${envelopeId} AND lower(email) = lower(${s.email})
    `;
  }
}

/**
 * Completion side effects for every document on the envelope: archive the
 * combined signed PDF (idempotent) and flip deals.baa_signed when the
 * document was the buyer agency agreement.
 */
export async function handleEnvelopeCompleted(envelopeId: string): Promise<void> {
  const docs = await prisma.documents.findMany({
    where: { docusign_envelope_id: envelopeId },
    select: { id: true, deal_id: true, purpose: true },
  });
  for (const doc of docs) {
    await archiveCompletedEnvelope(doc.id);
    if (doc.purpose === "baa") {
      await prisma.deals.update({
        where: { id: doc.deal_id },
        data: { baa_signed: true, updated_at: new Date() },
      });
    }
  }
}

export async function archiveCompletedEnvelope(documentId: string): Promise<void> {
  try {
    const doc = await prisma.documents.findUnique({
      where: { id: documentId },
      select: {
        deal_id: true,
        name: true,
        docusign_envelope_id: true,
        docusign_signed_s3_key: true,
      },
    });
    if (!doc || !doc.docusign_envelope_id) return;
    if (doc.docusign_signed_s3_key) return; // already archived

    const bytes = await getDocusignClient().downloadCombinedDocument(
      doc.docusign_envelope_id
    );
    const base = doc.name.replace(/\.pdf$/i, "");
    const key = makeS3Key(doc.deal_id, `${base}-signed.pdf`);
    await putObjectBytes(key, bytes, "application/pdf");

    await prisma.documents.update({
      where: { id: documentId },
      data: {
        docusign_signed_s3_key: key,
        docusign_completed_at: new Date(),
      },
    });
  } catch (err) {
    console.error("docusign archive failed (will self-heal on refresh)", {
      documentId,
      err,
    });
  }
}
