import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { getDownloadUrl } from "@/lib/s3";

type Ctx = { params: Promise<{ docId: string }> };

// GET /api/me/doc-templates/[docId]/download-url — returns a pre-signed S3 GET
// URL for a template, ownership-checked.
export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { docId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    const rows = await prisma.$queryRaw<{ s3_key: string }[]>`
      SELECT s3_key
      FROM agent_doc_templates
      WHERE id = ${docId}::uuid AND agent_id = ${userId}::uuid
    `;
    const row = rows[0];
    if (!row) return error("template not found", 404);

    const url = await getDownloadUrl({ key: row.s3_key });
    return json({ download_url: url });
  })) as Response;
}
