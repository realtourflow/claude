import { error } from "@/lib/http";
import { storageConfigured, verifyUpload, putBlob } from "@/lib/blob-storage";

// The client PUTs the file body here (Blob has no native pre-signed PUT). Authorized
// by the HMAC capability in the query — issued by the authed getUploadUrl for this
// exact key — NOT by a JWT, so the client's plain `fetch(url, {method:'PUT'})` works
// unchanged. Every uploaded file (deal docs, agent templates, agent forms) flows here.
export const maxDuration = 60;
const MAX_BYTES = 25 * 1024 * 1024;

// The three key namespaces the app writes (see lib/s3 key generators). Anything else
// is rejected as defense-in-depth against a forged/misused capability.
const ALLOWED_PREFIXES = ["deals/", "agent-templates/", "agent-forms/"];

export async function PUT(req: Request): Promise<Response> {
  if (!storageConfigured()) return error("blob storage not configured", 404);

  const u = new URL(req.url);
  const key = u.searchParams.get("key") ?? "";
  const exp = Number(u.searchParams.get("exp"));
  const sig = u.searchParams.get("sig") ?? "";

  // Defense-in-depth: only known key namespaces, and the capability must verify.
  if (!ALLOWED_PREFIXES.some((p) => key.startsWith(p))) return error("invalid key", 400);
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
