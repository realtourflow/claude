/**
 * Shared DocuSign send path for deal documents — used by the single-document
 * send-for-signature route, the template-send route, and the disclosure-packet
 * route.
 *
 * Both paths create ONE envelope, stamp the envelope id / "sent" status onto
 * the documents row, and record one docusign_recipients row per signer (the
 * per-recipient state later phases use for embedded signing + webhook events).
 *
 * Template sends have no uploaded PDF: the documents row is created here as a
 * pending-signature placeholder (s3_key = '') whose only artifact will be the
 * signed PDF a later phase archives into docusign_signed_s3_key.
 *
 * Throws when envelope creation fails — the caller decides how to clean up
 * (the single-doc route just reports 502; the packet + template paths also
 * remove the row they created).
 */
import { prisma } from "./db";
import {
  getDocusignClient,
  type DocusignSigner,
  type TemplateRole,
} from "./docusign";
import type { DealPerson } from "./docusign-routing";

export type EnvelopeRecipient = {
  userId: string | null;
  email: string;
  name: string;
  role: string;
  recipientId: string;
  routingOrder: number;
  clientUserId: string | null;
};

export function recipientsFromSigners(
  signers: DocusignSigner[],
  people: DealPerson[] = []
): EnvelopeRecipient[] {
  return signers.map((s, i) => ({
    userId: s.userId ?? s.clientUserId ?? null,
    email: s.email,
    name: s.name,
    role: people.find((p) => p.userId === (s.userId ?? s.clientUserId))?.role ?? "",
    recipientId: s.recipientId ?? String(i + 1),
    routingOrder: s.routingOrder ?? i + 1,
    clientUserId: s.clientUserId ?? null,
  }));
}

export function recipientsFromTemplateRoles(
  roles: TemplateRole[]
): EnvelopeRecipient[] {
  // recipient_id is a local ordinal here: DocuSign assigns its own recipient
  // ids to template roles, so later phases match these rows by user/email —
  // never by this id.
  return roles.map((r, i) => ({
    userId: r.userId ?? r.clientUserId ?? null,
    email: r.email,
    name: r.name,
    role: r.roleName,
    recipientId: String(i + 1),
    routingOrder: r.routingOrder ?? i + 1,
    clientUserId: r.clientUserId ?? null,
  }));
}

async function insertRecipients(
  documentId: string,
  envelopeId: string,
  recipients: EnvelopeRecipient[]
): Promise<void> {
  if (recipients.length === 0) return;
  await prisma.docusign_recipients.createMany({
    data: recipients.map((r) => ({
      document_id: documentId,
      envelope_id: envelopeId,
      user_id: r.userId,
      email: r.email,
      name: r.name,
      role: r.role,
      recipient_id: r.recipientId,
      routing_order: r.routingOrder,
      client_user_id: r.clientUserId,
      status: "sent",
    })),
  });
}

export async function sendDocumentEnvelope(input: {
  documentId: string;
  docName: string;
  bytes: Uint8Array;
  signers: DocusignSigner[];
  recipients?: EnvelopeRecipient[];
  purpose?: string;
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
      ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
    },
  });
  await insertRecipients(
    input.documentId,
    envelopeId,
    input.recipients ?? recipientsFromSigners(input.signers)
  );
  return { envelopeId, sentAt };
}

export async function sendTemplateEnvelope(input: {
  dealId: string;
  uploadedBy: string;
  template: { templateId: string; label: string; purpose: string };
  roles: TemplateRole[];
}): Promise<{ documentId: string; envelopeId: string; sentAt: Date }> {
  // Placeholder row first so the envelope has a document to hang off; removed
  // again if DocuSign rejects the send.
  const doc = await prisma.documents.create({
    data: {
      deal_id: input.dealId,
      uploaded_by: input.uploadedBy,
      name: input.template.label,
      s3_key: "",
      mime_type: "application/pdf",
      purpose: input.template.purpose,
    },
    select: { id: true },
  });

  try {
    const envelopeId = await getDocusignClient().createTemplateEnvelope(
      input.template.templateId,
      input.roles
    );
    const sentAt = new Date();
    await prisma.documents.update({
      where: { id: doc.id },
      data: {
        docusign_envelope_id: envelopeId,
        docusign_status: "sent",
        docusign_sent_at: sentAt,
      },
    });
    await insertRecipients(
      doc.id,
      envelopeId,
      recipientsFromTemplateRoles(input.roles)
    );
    return { documentId: doc.id, envelopeId, sentAt };
  } catch (err) {
    await prisma.documents.delete({ where: { id: doc.id } }).catch(() => {});
    throw err;
  }
}
