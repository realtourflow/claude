import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { getDownloadUrl } from "@/lib/s3";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: docId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    const rows = await prisma.$queryRaw<
      { s3_key: string; docusign_signed_s3_key: string | null }[]
    >`
      SELECT d.s3_key, d.docusign_signed_s3_key
      FROM documents d
      JOIN deals ON deals.id = d.deal_id
      WHERE d.id = ${docId}::uuid AND (
        deals.agent_id = ${userId}::uuid
        OR EXISTS (
          SELECT 1 FROM deal_participants
          WHERE deal_id = deals.id AND user_id = ${userId}::uuid
        )
      )
    `;
    const row = rows[0];
    if (!row) return error("document not found", 404);

    // Prefer the signed copy once archival fills it. Template sends start as
    // placeholder rows (s3_key='') with no file until the envelope completes.
    const key = row.docusign_signed_s3_key || row.s3_key;
    if (!key) return error("document has no file yet — awaiting signatures", 404);

    const url = await getDownloadUrl({ key });
    return json({ download_url: url });
  })) as Response;
}
