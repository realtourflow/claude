import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { hasDealAccess } from "@/lib/deals";

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
};

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    const access = await hasDealAccess(dealId, userId);
    if (!access) return error("deal not found", 404);

    const rows = await prisma.$queryRaw<DocumentRow[]>`
      SELECT d.id, d.deal_id, d.uploaded_by, u.name AS uploader_name,
             d.name, d.s3_key, d.mime_type, d.file_size, d.created_at,
             d.docusign_envelope_id, d.docusign_status, d.docusign_sent_at
      FROM documents d
      JOIN users u ON u.id = d.uploaded_by
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

    const owned = await prisma.deals.findFirst({
      where: { id: dealId, agent_id: userId },
      select: { id: true },
    });
    if (!owned) return error("deal not found", 404);

    let body: CreateBody;
    try {
      body = (await req.json()) as CreateBody;
    } catch {
      return error("invalid request body", 400);
    }
    if (!body.name || !body.s3_key) {
      return error("name and s3_key are required", 400);
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
    return json({ ...doc, file_size: Number(doc.file_size) }, 201);
  })) as Response;
}
