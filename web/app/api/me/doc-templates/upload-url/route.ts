import { error, json, withAuth } from "@/lib/http";
import { resolveUserId } from "@/lib/users";
import { getUploadUrl, makeAgentDocS3Key } from "@/lib/s3";

type UploadBody = { file_name?: string; mime_type?: string };

// POST /api/me/doc-templates/upload-url — returns a pre-signed S3 PUT URL +
// an agent-scoped key for a doc-template upload.
export async function POST(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    let body: UploadBody;
    try {
      body = (await req.json()) as UploadBody;
    } catch {
      return error("file_name is required", 400);
    }
    if (!body.file_name) return error("file_name is required", 400);

    const key = makeAgentDocS3Key(userId, body.file_name);
    const url = await getUploadUrl({
      key,
      contentType: body.mime_type ?? "application/octet-stream",
    });
    return json({ upload_url: url, s3_key: key });
  })) as Response;
}
