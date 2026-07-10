import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { canReadDeal, hasDealAccess } from "@/lib/deals";
import { emailDocumentUploaded } from "@/lib/notification-email";

type Ctx = { params: Promise<{ id: string }> };

type DocumentRow = {
  id: string;
  deal_id: string;
  uploaded_by: string;
  uploader_name: string;
  name: string;
  s3_key: string;
  mime_type: string;
  file_size: bigint;
  created_at: Date;
  docusign_envelope_id: string | null;
  docusign_status: string | null;
  docusign_sent_at: Date | null;
  purpose: string;
  my_recipient_status: string | null;
};

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    // Read access (#167): agent owner, participant, linked TC, or admin.
    // Uploads (POST below) stay agent/participant-only.
    const access = await canReadDeal(dealId, userId, claims.roles);
    if (!access) return error("deal not found", 404);

    const rows = await prisma.$queryRaw<DocumentRow[]>`
      SELECT d.id, d.deal_id, d.uploaded_by, u.name AS uploader_name,
             d.name, d.s3_key, d.mime_type, d.file_size, d.created_at,
             d.docusign_envelope_id, d.docusign_status, d.docusign_sent_at,
             d.purpose,
             dr.status AS my_recipient_status
      FROM documents d
      JOIN users u ON u.id = d.uploaded_by
      LEFT JOIN docusign_recipients dr
        ON dr.document_id = d.id AND dr.user_id = ${userId}::uuid
      WHERE d.deal_id = ${dealId}::uuid
      ORDER BY d.created_at DESC
    `;
    return json(rows.map((r) => ({ ...r, file_size: Number(r.file_size) })));
  })) as Response;
}

type CreateBody = {
  name?: string;
  s3_key?: string;
  mime_type?: string;
  file_size?: number;
};

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    // Agent owner OR deal participant (buyer/seller) may add a document.
    const access = await hasDealAccess(dealId, userId);
    if (!access) return error("deal not found", 404);

    let body: CreateBody;
    try {
      body = (await req.json()) as CreateBody;
    } catch {
      return error("invalid request body", 400);
    }
    if (!body.name || !body.s3_key) {
      return error("name and s3_key are required", 400);
    }
    // The key must live under this deal's prefix (upload-url only ever issues
    // `deals/<dealId>/...`). Without this, a member of deal A could confirm a
    // row pointing at deal B's object — now reachable by participants, not just
    // the agent, so harden it here.
    if (!body.s3_key.startsWith(`deals/${dealId}/`)) {
      return error("s3_key does not belong to this deal", 400);
    }

    const rows = await prisma.$queryRaw<DocumentRow[]>`
      WITH inserted AS (
        INSERT INTO documents (deal_id, uploaded_by, name, s3_key, mime_type, file_size)
        VALUES (${dealId}::uuid, ${userId}::uuid, ${body.name}, ${body.s3_key},
                ${body.mime_type ?? "application/octet-stream"},
                ${body.file_size ?? 0})
        RETURNING id, deal_id, uploaded_by, name, s3_key, mime_type, file_size, created_at,
                  docusign_envelope_id, docusign_status, docusign_sent_at
      )
      SELECT i.id, i.deal_id, i.uploaded_by, u.name AS uploader_name,
             i.name, i.s3_key, i.mime_type, i.file_size, i.created_at,
             i.docusign_envelope_id, i.docusign_status, i.docusign_sent_at
      FROM inserted i
      JOIN users u ON u.id = i.uploaded_by
    `;
    const doc = rows[0];

    // Best-effort email to the deal's client(s). Awaited (not detached) so it
    // sends on Vercel; a throw must never block the response.
    try {
      await emailDocumentUploaded({
        req,
        dealId,
        uploaderId: userId,
        documentName: doc.name,
      });
    } catch (err) {
      console.error("document notification email failed", err);
    }

    return json({ ...doc, file_size: Number(doc.file_size) }, 201);
  })) as Response;
}
