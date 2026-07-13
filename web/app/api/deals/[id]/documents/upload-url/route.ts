import { error, json, withAuth } from "@/lib/http";
import { resolveUserId } from "@/lib/users";
import { hasDealAccess } from "@/lib/deals";
import { getUploadUrl, getClientUploadUrl, makeS3Key } from "@/lib/s3";

type Ctx = { params: Promise<{ id: string }> };

type UploadBody = { file_name?: string; mime_type?: string };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    // Agent owner OR deal participant (buyer/seller) may upload to the deal.
    if (!(await hasDealAccess(dealId, userId))) return error("deal not found", 404);

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
    // #189: client_upload_url is the direct-to-Blob grant route — the browser
    // pushes the bytes straight to Blob (no ~4.5MB function proxy in the byte
    // path). upload_url remains the proxy capability, kept as the fallback.
    const clientUploadUrl = await getClientUploadUrl({ key });
    return json({ upload_url: url, client_upload_url: clientUploadUrl, s3_key: key });
  })) as Response;
}
