import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";

type TemplateRow = {
  id: string;
  agent_id: string;
  name: string;
  doc_type: string;
  file_name: string;
  s3_key: string;
  mime_type: string;
  file_size: bigint;
  notes: string | null;
  created_at: Date;
};

function serialize(r: TemplateRow) {
  return { ...r, file_size: Number(r.file_size) };
}

// GET /api/me/doc-templates — lists all templates for the calling agent.
export async function GET(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    const rows = await prisma.$queryRaw<TemplateRow[]>`
      SELECT id, agent_id, name, doc_type, file_name, s3_key,
             mime_type, file_size, notes, created_at
      FROM agent_doc_templates
      WHERE agent_id = ${userId}::uuid
      ORDER BY created_at DESC
    `;
    return json(rows.map(serialize));
  })) as Response;
}

type CreateBody = {
  name?: string;
  doc_type?: string;
  file_name?: string;
  s3_key?: string;
  mime_type?: string;
  file_size?: number;
  notes?: string | null;
};

// POST /api/me/doc-templates — saves a template row after the browser uploads to S3.
export async function POST(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    let body: CreateBody;
    try {
      body = (await req.json()) as CreateBody;
    } catch {
      return error("invalid request body", 400);
    }
    if (!body.name || !body.doc_type || !body.s3_key) {
      return error("name, doc_type, and s3_key are required", 400);
    }

    const rows = await prisma.$queryRaw<TemplateRow[]>`
      INSERT INTO agent_doc_templates
        (agent_id, name, doc_type, file_name, s3_key, mime_type, file_size, notes)
      VALUES (${userId}::uuid, ${body.name}, ${body.doc_type},
              ${body.file_name ?? ""}, ${body.s3_key},
              ${body.mime_type ?? "application/octet-stream"},
              ${body.file_size ?? 0}, ${body.notes ?? null})
      RETURNING id, agent_id, name, doc_type, file_name, s3_key,
                mime_type, file_size, notes, created_at
    `;
    return json(serialize(rows[0]), 201);
  })) as Response;
}
