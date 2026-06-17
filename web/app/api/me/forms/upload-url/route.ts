import { error, json, withAuth } from "@/lib/http";
import { resolveUserId } from "@/lib/users";
import { getUploadUrl, makeAgentFormS3Key } from "@/lib/s3";

type UploadBody = { file_name?: string; mime_type?: string };

// POST /api/me/forms/upload-url — pre-signed S3 PUT URL + an agent-scoped
// `agent-forms/` key for an uploaded blank form (the form-upload pipeline).
export async function POST(req: Request): Promise<Response> {
  return (await withAuth(
    req,
    async (claims): Promise<Response> => {
      const userId = await resolveUserId(claims.sub);
      if (!userId) return error("user not found", 404);

      let body: UploadBody;
      try {
        body = (await req.json()) as UploadBody;
      } catch {
        return error("file_name is required", 400);
      }
      if (!body.file_name) return error("file_name is required", 400);

      const key = makeAgentFormS3Key(userId, body.file_name);
      const url = await getUploadUrl({
        key,
        contentType: body.mime_type ?? "application/pdf",
      });
      return json({ upload_url: url, s3_key: key });
    },
    { allowedRoles: ["agent", "admin"] }
  )) as Response;
}
