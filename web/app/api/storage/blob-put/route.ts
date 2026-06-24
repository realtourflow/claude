import { error } from "@/lib/http";
import { blobEnabled, verifyUpload, putBlob } from "@/lib/blob-storage";

// The client PUTs the file body here (Blob has no native pre-signed PUT). Authorized
// by the HMAC capability in the query — issued by the authed getUploadUrl for this
// exact key — NOT by a JWT, so the client's plain `fetch(url, {method:'PUT'})` works
// unchanged across both backends. Only active when Blob is configured (Preview).
export const maxDuration = 60;
const MAX_BYTES = 25 * 1024 * 1024;

export async function PUT(req: Request): Promise<Response> {
  if (!blobEnabled()) return error("blob storage not configured", 404);

  const u = new URL(req.url);
  const key = u.searchParams.get("key") ?? "";
  const exp = Number(u.searchParams.get("exp"));
  const sig = u.searchParams.get("sig") ?? "";

  // Defense-in-depth: only agent-form keys, and the capability must verify.
  if (!key.startsWith("agent-forms/")) return error("invalid key", 400);
  if (!verifyUpload(key, exp, sig)) return error("invalid or expired upload token", 403);

  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    return error(`file too large — max ${MAX_BYTES / (1024 * 1024)}MB`, 413);
  }
  const contentType = req.headers.get("content-type") || "application/pdf";
  try {
    await putBlob(key, new Uint8Array(buf), contentType);
  } catch (err) {
    console.error("blob put failed", err);
    return error("upload failed", 500);
  }
  return new Response(null, { status: 200 });
}
