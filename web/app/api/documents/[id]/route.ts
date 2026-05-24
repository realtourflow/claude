import { error, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { deleteObject } from "@/lib/s3";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const { id: docId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    const rows = await prisma.$queryRaw<{ s3_key: string }[]>`
      SELECT d.s3_key
      FROM documents d
      JOIN deals ON deals.id = d.deal_id
      WHERE d.id = ${docId}::uuid AND deals.agent_id = ${userId}::uuid
    `;
    const row = rows[0];
    if (!row) return error("document not found", 404);

    await prisma.documents.delete({ where: { id: docId } });
    // Best-effort S3 cleanup. Never fails the request.
    void deleteObject(row.s3_key);

    return new Response(null, { status: 204 });
  })) as Response;
}
