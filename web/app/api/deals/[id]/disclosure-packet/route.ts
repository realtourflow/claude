import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { getDocusignClient } from "@/lib/docusign";
import { sendDocumentEnvelope } from "@/lib/docusign-documents";
import { assembleDisclosurePacket, DisclosureError } from "@/lib/disclosures";
import { deleteObject, makeS3Key, putObjectBytes } from "@/lib/s3";

type Ctx = { params: Promise<{ id: string }> };

type PacketBody = {
  document_ids?: string[];
  signer?: { email?: string; name?: string };
};

// POST /api/deals/[id]/disclosure-packet (FF5 #23)
//
// Merges the selected PDF documents into one packet, stores it in S3 as a
// regular deal document, and sends that document for signature through the
// existing DocuSign envelope path. Because the packet is a normal documents
// row with docusign_* columns, the existing webhook keeps its status current.
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    // Only the deal's owning agent may send a disclosure packet.
    const owned = await prisma.deals.findFirst({
      where: { id: dealId, agent_id: userId },
      select: { id: true },
    });
    if (!owned) return error("deal not found or access denied", 404);

    const docusign = getDocusignClient();
    if (!docusign.enabled()) {
      return error("DocuSign not configured", 503);
    }

    let body: PacketBody;
    try {
      body = (await req.json()) as PacketBody;
    } catch {
      return error("invalid request body", 400);
    }
    const documentIds = Array.isArray(body.document_ids)
      ? body.document_ids.filter(
          (d): d is string => typeof d === "string" && d.length > 0
        )
      : [];
    const signerEmail = body.signer?.email ?? "";
    const signerName = body.signer?.name ?? "";
    if (!signerEmail || !signerName) {
      return error("signer email and name required", 400);
    }

    let packet;
    try {
      packet = await assembleDisclosurePacket({ dealId, documentIds });
    } catch (err) {
      if (err instanceof DisclosureError) {
        return error(err.message, err.code === "not_found" ? 404 : 400);
      }
      throw err;
    }

    // Store the merged PDF, then record it as a regular deal document.
    const s3Key = makeS3Key(dealId, `disclosure-packet-${Date.now()}.pdf`);
    await putObjectBytes(s3Key, packet.bytes, "application/pdf");

    const row = await prisma.documents.create({
      data: {
        deal_id: dealId,
        uploaded_by: userId,
        name: packet.name,
        s3_key: s3Key,
        mime_type: "application/pdf",
        file_size: packet.bytes.length,
      },
      include: { users: { select: { name: true } } },
    });

    let envelopeId: string;
    let sentAt: Date;
    try {
      ({ envelopeId, sentAt } = await sendDocumentEnvelope({
        documentId: row.id,
        docName: packet.name,
        bytes: packet.bytes,
        signers: [{ email: signerEmail, name: signerName }],
      }));
    } catch (err) {
      // No orphan half-sent packets: drop the row + best-effort S3 delete.
      await prisma.documents.delete({ where: { id: row.id } });
      await deleteObject(s3Key).catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      return error("failed to create envelope: " + msg, 502);
    }

    return json(
      {
        id: row.id,
        deal_id: row.deal_id,
        uploaded_by: row.uploaded_by,
        uploader_name: row.users.name,
        name: row.name,
        s3_key: row.s3_key,
        mime_type: row.mime_type,
        file_size: Number(row.file_size),
        created_at: row.created_at,
        docusign_envelope_id: envelopeId,
        docusign_status: "sent",
        docusign_sent_at: sentAt,
      },
      201
    );
  })) as Response;
}
