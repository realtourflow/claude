import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { hasDealAccess } from "@/lib/deals";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    const access = await hasDealAccess(dealId, userId);
    if (!access) return error("deal not found", 404);

    const rows = await prisma.$queryRaw<
      {
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
      }[]
    >`
      SELECT t.id, t.agent_id, t.name, t.doc_type, t.file_name, t.s3_key,
             t.mime_type, t.file_size, t.notes, t.created_at
      FROM agent_doc_templates t
      JOIN deals d ON d.agent_id = t.agent_id
      WHERE d.id = ${dealId}::uuid
      ORDER BY t.created_at DESC
    `;
    return json(rows.map((r) => ({ ...r, file_size: Number(r.file_size) })));
  })) as Response;
}
