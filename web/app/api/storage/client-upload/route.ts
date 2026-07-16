import { error, json } from "@/lib/http";
import {
  storageConfigured,
  verifyUpload,
  createClientUploadGrant,
  ALLOWED_KEY_PREFIXES,
  validateUploadType,
} from "@/lib/blob-storage";

// #189 — the direct-to-Blob upload token route. @vercel/blob/client's
// uploadPresigned() POSTs a tiny JSON envelope here and gets back a presigned
// grant; the browser then PUTs the FILE BYTES straight to the Blob API. No
// Vercel Function ever touches the body, which is what fixes the platform's
// ~4.5MB request-body cap (files 4.5–25MB previously could not upload at all).
//
// Authorization is the SAME short-lived HMAC "put" capability that authorizes
// the blob-put proxy — minted per-key by the authed upload-url routes AFTER
// their ownership checks — so ownership, key pinning, namespace, and TTL
// semantics are identical to the proxy path. The grant this route mints is
// itself pinned server-side to that one key with the 25MB cap signed in.

type GrantBody = {
  type?: string;
  payload?: { pathname?: string; multipart?: boolean; clientPayload?: string | null };
};

export async function POST(req: Request): Promise<Response> {
  if (!storageConfigured()) return error("blob storage not configured", 404);

  const u = new URL(req.url);
  const key = u.searchParams.get("key") ?? "";
  const exp = Number(u.searchParams.get("exp"));
  const sig = u.searchParams.get("sig") ?? "";

  // Defense-in-depth: only known key namespaces, and the capability must verify.
  if (!ALLOWED_KEY_PREFIXES.some((p) => key.startsWith(p))) return error("invalid key", 400);
  if (!verifyUpload(key, exp, sig)) return error("invalid or expired upload token", 403);

  // Constrain the minted grant to allowed file types (#275): the grant is pinned
  // to this exact key, so gating on its extension keeps a disallowed type (an
  // .exe / .html / .svg dressed up as a doc) from ever being uploaded. The body's
  // pathname is separately required to equal this key below.
  const typeCheck = validateUploadType({ key });
  if (!typeCheck.ok) return error(typeCheck.reason, 415);

  let body: GrantBody;
  try {
    body = (await req.json()) as GrantBody;
  } catch {
    return error("invalid request body", 400);
  }
  if (body?.type !== "blob.generate-presigned-url") {
    return error("unsupported event type", 400);
  }
  // The capability pins ONE exact key — the requested pathname must match it.
  if (body.payload?.pathname !== key) {
    return error("pathname does not match the upload token", 400);
  }
  // The 25MB cap never needs multipart; rejecting it keeps grants single-shot.
  if (body.payload?.multipart) {
    return error("multipart uploads are not supported", 400);
  }

  try {
    const presignedUrlPayload = await createClientUploadGrant(key);
    return json({ type: "blob.generate-presigned-url", presignedUrlPayload });
  } catch (err) {
    console.error("client upload grant failed", err);
    return error("could not create upload grant", 500);
  }
}
