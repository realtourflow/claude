import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { deleteObject } from "@/lib/s3";

type Ctx = { params: Promise<{ docId: string }> };

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

type PatchBody = { name?: string; notes?: string | null };

// PATCH /api/me/doc-templates/[docId] — partial update (name/notes),
// ownership-checked.
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { docId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    let body: PatchBody;
    try {
      body = (await req.json()) as PatchBody;
    } catch {
      return error("invalid request body", 400);
    }

    const name = body.name ?? null;
    const notesProvided = "notes" in body;
    const notes = body.notes ?? null;

    const rows = await prisma.$queryRaw<TemplateRow[]>`
      UPDATE agent_doc_templates
      SET name  = COALESCE(${name}, name),
          notes = CASE WHEN ${notesProvided} THEN ${notes} ELSE notes END
      WHERE id = ${docId}::uuid AND agent_id = ${userId}::uuid
      RETURNING id, agent_id, name, doc_type, file_name, s3_key,
                mime_type, file_size, notes, created_at
    `;
    const row = rows[0];
    if (!row) return error("template not found", 404);

    return json({ ...row, file_size: Number(row.file_size) });
  })) as Response;
}

// DELETE /api/me/doc-templates/[docId] — removes the row + best-effort S3 delete,
// ownership-checked.
export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const { docId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    const rows = await prisma.$queryRaw<{ s3_key: string }[]>`
      DELETE FROM agent_doc_templates
      WHERE id = ${docId}::uuid AND agent_id = ${userId}::uuid
      RETURNING s3_key
    `;
    const row = rows[0];
    if (!row) return error("template not found", 404);

    // Best-effort S3 cleanup — awaited so Vercel can't freeze the function
    // before it runs (deleteObject swallows errors; never fails the request).
    await deleteObject(row.s3_key);

    return new Response(null, { status: 204 });
  })) as Response;
}
