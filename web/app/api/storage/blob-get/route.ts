import { error } from "@/lib/http";
import {
  storageConfigured,
  verifyDownload,
  getBlobBytes,
  getBlobContentType,
  ALLOWED_KEY_PREFIXES,
} from "@/lib/blob-storage";

// The browser GETs the file body here. Authorized by the HMAC capability in the query
// — issued by the authed getDownloadUrl for this exact key AFTER an ownership check —
// NOT by a JWT, so `window.open(url)` works (a top-level navigation carries no
// Authorization header). Mirrors an S3 pre-signed GET: short-lived, key-scoped,
// bearer-free. The private Blob store's bytes are streamed through this proxy because
// a private blob URL can't be opened directly by the browser.
export const maxDuration = 60;

// The three key namespaces the app reads (see lib/s3 key generators).
const ALLOWED_PREFIXES = ALLOWED_KEY_PREFIXES;

// Content types safe to render inline so the browser can PREVIEW them instead of
// forcing a download (#310). Deliberately a NARROW ALLOWLIST, never a denylist:
// anything not listed here — office docs, archives, unknown/octet-stream, and
// crucially text/html and image/svg+xml (which a browser would EXECUTE →
// stored-XSS / drive-by) — is served as `attachment`. Add a type here only after
// confirming the browser renders it as inert, non-scriptable content.
const INLINE_PREVIEWABLE_TYPES = new Set<string>([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export async function GET(req: Request): Promise<Response> {
  if (!storageConfigured()) return error("blob storage not configured", 404);

  const u = new URL(req.url);
  const key = u.searchParams.get("key") ?? "";
  const exp = Number(u.searchParams.get("exp"));
  const sig = u.searchParams.get("sig") ?? "";

  // Defense-in-depth: only known key namespaces, and the capability must verify.
  if (!ALLOWED_PREFIXES.some((p) => key.startsWith(p))) return error("invalid key", 400);
  if (!verifyDownload(key, exp, sig)) return error("invalid or expired download token", 403);

  let bytes: Uint8Array;
  let contentType: string;
  try {
    [bytes, contentType] = await Promise.all([
      getBlobBytes(key),
      getBlobContentType(key),
    ]);
  } catch (err) {
    console.error("blob get failed", err);
    return error("file not found", 404);
  }

  const filename = (key.split("/").pop() || "download").replace(/"/g, "");
  // Preview safe types inline; force everything else (office docs, unknown, and
  // especially html/svg — XSS risk) to download. Normalize first: drop any
  // `; charset=…` parameter and lowercase, so a variant like `TEXT/HTML` or
  // `image/jpeg; charset=binary` is classified correctly. Allowlist match means
  // an unknown/empty type can never slip through as inline.
  const baseType = (contentType || "").split(";")[0].trim().toLowerCase();
  const disposition = INLINE_PREVIEWABLE_TYPES.has(baseType) ? "inline" : "attachment";

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": contentType || "application/octet-stream",
      "content-disposition": `${disposition}; filename="${filename}"`,
      // Stop the browser from MIME-sniffing a declared safe type into an
      // executable one — pins rendering to the content-type above (defense in
      // depth for the inline allowlist).
      "x-content-type-options": "nosniff",
      // Capability URLs are single-use-ish (short TTL) and per-key; don't let a shared
      // cache hold private document bytes.
      "cache-control": "private, no-store",
    },
  });
}
