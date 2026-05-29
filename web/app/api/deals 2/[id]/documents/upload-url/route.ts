import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { getUploadUrl, makeS3Key } from "@/lib/s3";

type Ctx = { params: Promise<{ id: string }> };

type UploadBody = { file_name?: string; mime_type?: string };

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

    let body: UploadBody;
    try {
      body = (await req.json()) as UploadBody;
    } catch {
      return error("file_name is required", 400);
    }
    if (!body.file_name) return error("file_name is required", 400);

    const key = makeS3Key(dealId, body.file_name);
    const url = await getUploadUrl({
      key,
      contentType: body.mime_type ?? "application/octet-stream",
    });
    return json({ upload_url: url, s3_key: key });
  })) as Response;
}
