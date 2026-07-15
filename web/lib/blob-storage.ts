/**
 * Vercel Blob storage backend — the app's single file-storage backend (S3 retired).
 * lib/s3 is a thin facade over these functions; every upload/download/read/write of a
 * document, agent form, or disclosure packet lands here.
 *
 * Auth: supports BOTH Vercel Blob modes — a static BLOB_READ_WRITE_TOKEN, OR (the
 * newer store model) OIDC: the SDK exchanges the deployment's VERCEL_OIDC_TOKEN +
 * BLOB_STORE_ID when no token is passed. So we pass `token` only when we actually
 * have one, and otherwise let the SDK use OIDC.
 *
 * The store is PRIVATE — blobs require authentication to read, so writes use
 * access:'private' and reads go through the SDK's authenticated get/head (NOT a raw
 * public-URL fetch). Because a private blob URL can't be opened by the browser, both
 * client-direct uploads AND downloads go through tiny proxy routes
 * (/api/storage/blob-put, /api/storage/blob-get) authorized by a short-lived HMAC
 * capability over the key — the same shape as an S3 pre-signed PUT/GET, signed with
 * the dedicated server-only BLOB_CAP_SECRET (required in production; see hmacSecret).
 * `window.open(url)` sends no Authorization header, so the capability (not the JWT)
 * is what authorizes the streamed bytes.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { put, del, head, get, issueSignedToken, presignUrl } from "@vercel/blob";
import { env } from "./env";

// The store is PRIVATE — see the file header. Writes are private; reads are authed.
const ACCESS = "private" as const;

/** App-wide upload size cap (25MB) — enforced by the blob-put proxy AND signed
 * into every direct-upload grant (#189). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** The three key namespaces the app reads/writes (see lib/s3 key generators).
 * Anything else is rejected as defense-in-depth against a forged/misused
 * capability — shared by blob-put, blob-get, and client-upload. */
export const ALLOWED_KEY_PREFIXES = ["deals/", "agent-templates/", "agent-forms/"];

// ---------------------------------------------------------------------------
// Upload content-type / extension allowlist (#275)
// ---------------------------------------------------------------------------
// Every upload is later handed to OTHER deal participants as a trusted
// "document" (they download it by name). Without a type gate, a participant
// could distribute an executable (.exe), a script-bearing page (.html / .svg),
// or any other active-content file dressed up as a doc. So both upload entry
// points — the blob-put proxy AND the client-upload grant route — restrict
// uploads to the inert document/image types the app actually needs, via the
// single validateUploadType() below (one definition, no drift between routes).

/** extension (lowercase, no dot) -> the content-types we accept for it. */
const ALLOWED_UPLOAD_TYPE_MAP: Record<string, readonly string[]> = {
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  gif: ["image/gif"],
  webp: ["image/webp"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.document"],
  txt: ["text/plain"],
};

/** The allowed file extensions (lowercase, no leading dot). */
export const ALLOWED_UPLOAD_EXTENSIONS: readonly string[] =
  Object.keys(ALLOWED_UPLOAD_TYPE_MAP);

/** The allowed content-types (deduped across the extension map). */
export const ALLOWED_UPLOAD_MIME_TYPES: readonly string[] = [
  ...new Set(Object.values(ALLOWED_UPLOAD_TYPE_MAP).flat()),
];

// Content-types a browser sends when it can't identify a file. These are inert
// (the browser downloads rather than renders them), so we don't reject on them —
// the extension gate is the reliable signal and still applies.
const GENERIC_CONTENT_TYPES = new Set([
  "application/octet-stream",
  "binary/octet-stream",
]);

/** The lowercase extension (no dot) of a key/filename, or "" when it has none. */
function extensionOf(keyOrName: string): string {
  const base = keyOrName.split(/[?#]/)[0].split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  // dot must be present and not the leading char (".env" is not an extension).
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export type UploadTypeCheck = { ok: true } | { ok: false; reason: string };

/**
 * Validate an upload against the allowlist (#275). The key/filename's extension
 * MUST be allowed; a provided content-type (when present and not a generic
 * unknown type) MUST also be allowed. `contentType` may be omitted — the
 * client-upload grant route only has the pinned key at mint time — in which case
 * the extension gate stands alone. Returns `{ok:true}` or `{ok:false, reason}`
 * so the route can surface a clear 415.
 */
export function validateUploadType(input: {
  key: string;
  contentType?: string | null;
}): UploadTypeCheck {
  const ext = extensionOf(input.key);
  if (!ext || !(ext in ALLOWED_UPLOAD_TYPE_MAP)) {
    return {
      ok: false,
      reason: `file type "${ext ? `.${ext}` : "(none)"}" is not allowed — allowed: ${ALLOWED_UPLOAD_EXTENSIONS.join(", ")}`,
    };
  }
  // Normalize: drop any "; charset=…" parameter, trim, lowercase.
  const ct = (input.contentType ?? "").split(";")[0].trim().toLowerCase();
  if (ct && !GENERIC_CONTENT_TYPES.has(ct) && !ALLOWED_UPLOAD_MIME_TYPES.includes(ct)) {
    return { ok: false, reason: `content-type "${ct}" is not an allowed document type` };
  }
  return { ok: true };
}

type StoredBlob = { bytes: Uint8Array; contentType: string };

/** A direct-upload grant recorded by the test seam (#189). */
export type ClientUploadGrant = {
  delegationToken: string;
  key: string;
  maximumSizeInBytes: number;
  validUntil: number;
};

// ---------------------------------------------------------------------------
// Test seam
// ---------------------------------------------------------------------------
// A recording in-memory backend that replaces @vercel/blob in tests: when installed,
// every operation uses it and NEVER touches the network or needs a token/store. It is
// the successor to the old setS3ClientForTesting (aws-sdk-client-mock) seam and maps
// almost line-for-line:
//   s3Mock.on(GetObjectCommand).resolves({Body: bodyOf(PDF)})  → storage.defaultBytes = PDF
//   s3Mock.on(HeadObjectCommand).resolves({ContentLength: n})  → storage.defaultSize = n
//   s3Mock.commandCalls(PutObjectCommand)                      → storage.puts
//   s3Mock.commandCalls(DeleteObjectCommand)                   → storage.deletes
//   s3Mock.on(DeleteObjectCommand).rejects(...)                → storage.failDeletes = true
// A `put` also seeds the key, so a later read of that exact key returns what was
// written (more faithful than the old mock — e.g. disclosure merge write-then-read).
export class TestStorage {
  /** Bytes returned by getBlobBytes for any key without an exact seed. */
  defaultBytes: Uint8Array | undefined;
  /** Size returned by getBlobSize (independent of bytes, mirroring HeadObject). */
  defaultSize: number | undefined;
  /** When true, deleteBlob throws (to exercise best-effort delete failure). */
  failDeletes = false;
  /**
   * When set, putBlob throws for any key this predicate returns true for — lets a
   * test simulate a storage failure on a specific object (e.g. one part of a
   * best-effort bundle split) without failing the others.
   */
  failPut?: (key: string) => boolean;
  readonly seeded = new Map<string, StoredBlob>();
  readonly puts: Array<{ key: string; bytes: Uint8Array; contentType: string }> = [];
  readonly deletes: string[] = [];
  /** Keys whose bytes were actually read — lets a test assert bytes were never fetched. */
  readonly reads: string[] = [];

  /** Direct-upload grants minted via createClientUploadGrant (#189). */
  readonly clientUploadGrants: ClientUploadGrant[] = [];

  seed(key: string, bytes: Uint8Array, contentType = "application/pdf"): void {
    this.seeded.set(key, { bytes, contentType });
  }
  /** Record a direct-upload grant (called by createClientUploadGrant in test mode). */
  grantClientUpload(
    key: string,
    maximumSizeInBytes: number,
    validUntil: number
  ): ClientUploadGrant {
    const grant: ClientUploadGrant = {
      delegationToken: `test-delegation-${this.clientUploadGrants.length + 1}:${key}`,
      key,
      maximumSizeInBytes,
      validUntil,
    };
    this.clientUploadGrants.push(grant);
    return grant;
  }
  /**
   * The test-seam equivalent of the BROWSER's direct PUT to Blob (#189):
   * enforces what the real API enforces from the signed grant — a grant must
   * exist, be unexpired, and the body must be under its size cap. The bytes
   * land under the grant's pinned key (the pathname is signed; the uploader
   * can't choose it).
   */
  directPut(
    delegationToken: string,
    bytes: Uint8Array,
    contentType = "application/pdf"
  ): void {
    const grant = this.clientUploadGrants.find(
      (g) => g.delegationToken === delegationToken
    );
    if (!grant) throw new Error("no grant exists for this delegation token");
    if (Date.now() > grant.validUntil) throw new Error("delegation grant expired");
    if (bytes.byteLength > grant.maximumSizeInBytes) {
      throw new Error(
        `file too large: the file length cannot be greater than the grant's ` +
          `maximum of ${grant.maximumSizeInBytes} bytes`
      );
    }
    this.puts.push({ key: grant.key, bytes, contentType });
    this.seed(grant.key, bytes, contentType);
  }
  bytesFor(key: string): Uint8Array {
    this.reads.push(key);
    const s = this.seeded.get(key);
    if (s) return s.bytes;
    if (this.defaultBytes) return this.defaultBytes;
    throw new Error(`blob not found: ${key}`);
  }
  contentTypeFor(key: string): string {
    return this.seeded.get(key)?.contentType ?? "application/pdf";
  }
  sizeFor(key: string): number {
    if (this.defaultSize !== undefined) return this.defaultSize;
    const s = this.seeded.get(key);
    if (s) return s.bytes.byteLength;
    if (this.defaultBytes) return this.defaultBytes.byteLength;
    throw new Error(`blob not found: ${key}`);
  }
}

let testStore: TestStorage | undefined;
// A fixed HMAC secret so capability URLs sign/verify without any env in tests.
const TEST_HMAC_SECRET = "rtf-test-blob-hmac-secret";

/**
 * Install a recording in-memory Blob backend for tests, or tear it down with `false`.
 * Returns the controller so a test can seed bytes and assert on puts/deletes.
 */
export function setStorageForTesting(on = true): TestStorage | undefined {
  testStore = on ? new TestStorage() : undefined;
  return testStore;
}

/** True when storage is usable: a test store is installed, or a real store/token exists. */
export function storageConfigured(): boolean {
  if (testStore) return true;
  const e = env();
  return !!(e.BLOB_READ_WRITE_TOKEN || e.BLOB_STORE_ID);
}

/** Fail loudly (not silently) when no backend is configured. */
export function assertStorageConfigured(): void {
  if (!storageConfigured()) {
    throw new Error(
      "Vercel Blob is not configured: set BLOB_READ_WRITE_TOKEN or connect a Blob " +
        "store (BLOB_STORE_ID) to the environment."
    );
  }
}

// SDK auth: pass the static R/W token if we have one; otherwise pass nothing so the
// SDK falls back to OIDC (VERCEL_OIDC_TOKEN + BLOB_STORE_ID) automatically.
function auth(): { token?: string } {
  const t = env().BLOB_READ_WRITE_TOKEN;
  return t ? { token: t } : {};
}

// HMAC secret for the upload/download capabilities — the DEDICATED
// BLOB_CAP_SECRET, exclusively. Never derived from BLOB_READ_WRITE_TOKEN and
// NEVER from BLOB_STORE_ID: the store id is a visible identifier (Vercel
// dashboard, env listings, blob hostnames), not a secret, so signing with it
// would let anyone forge a capability for any key (#188). lib/env.ts fails
// closed in production (requires 32+ random chars when VERCEL_ENV=production)
// and substitutes a committed dev value elsewhere so local dev / CI / previews
// stay zero-config.
function hmacSecret(): string {
  if (testStore) return TEST_HMAC_SECRET;
  return env().BLOB_CAP_SECRET;
}

// ---------------------------------------------------------------------------
// Capability URLs (bearer-free, short-lived, one action + one key)
// ---------------------------------------------------------------------------
const CAP_TTL_MS = 15 * 60 * 1000;

// Namespacing by action ("put"/"get") means a download capability can't be replayed
// as an upload capability (or vice versa) even for the same key.
function sign(action: "put" | "get", key: string, exp: number): string {
  return createHmac("sha256", hmacSecret()).update(`${action}|${key}|${exp}`).digest("hex");
}

function verify(action: "put" | "get", key: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = Buffer.from(sign(action, key, exp));
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** A capability URL the client PUTs the file to (mirrors an S3 pre-signed PUT URL). */
export function blobUploadPath(key: string): string {
  const exp = Date.now() + CAP_TTL_MS;
  return `/api/storage/blob-put?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sign("put", key, exp)}`;
}

/** A capability URL the browser opens to download the file (mirrors an S3 pre-signed GET URL). */
export function blobDownloadPath(key: string): string {
  const exp = Date.now() + CAP_TTL_MS;
  return `/api/storage/blob-get?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sign("get", key, exp)}`;
}

/**
 * A capability URL for the direct-upload grant route (#189) — the
 * `handleUploadUrl` @vercel/blob/client's uploadPresigned() POSTs its tiny
 * JSON envelope to. Signed with the SAME "put" action HMAC as blobUploadPath:
 * uploading a key through the proxy or minting a direct-upload grant for it
 * is the same privilege, so one capability authorizes either mechanism.
 */
export function blobClientUploadPath(key: string): string {
  const exp = Date.now() + CAP_TTL_MS;
  return `/api/storage/client-upload?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sign("put", key, exp)}`;
}

/** Verify an upload capability (timing-safe + not expired). */
export function verifyUpload(key: string, exp: number, sig: string): boolean {
  return verify("put", key, exp, sig);
}

/** Verify a download capability (timing-safe + not expired). */
export function verifyDownload(key: string, exp: number, sig: string): boolean {
  return verify("get", key, exp, sig);
}

// ---------------------------------------------------------------------------
// Direct-to-Blob client uploads (#189)
// ---------------------------------------------------------------------------
// Vercel Functions reject request bodies over ~4.5MB at the platform edge, so
// the blob-put proxy can never receive a 5–25MB file in production. For files
// the app's UI uploads, the browser instead pushes bytes STRAIGHT to Blob via
// the SDK's presigned flow: the capability-gated client-upload route calls
// createClientUploadGrant, which issues a signed, single-key, size-capped
// delegation via the Blob control plane. issueSignedToken authenticates like
// every other server SDK call — R/W token when present, otherwise OIDC
// (VERCEL_OIDC_TOKEN + BLOB_STORE_ID), which is exactly prod's setup. (Note:
// the SDK's `handleUpload` client-token flow was NOT used because in
// @vercel/blob 2.4.1 it hard-requires BLOB_READ_WRITE_TOKEN, which prod does
// not have.)

/** The payload @vercel/blob/client's uploadPresigned() expects from its token route. */
export type PresignedUploadPayload = {
  delegationToken: string;
  signature: string;
  params: Record<string, string>;
};

/**
 * Convert the SDK's presigned PUT URL back into the {delegationToken,
 * signature, params} payload uploadPresigned() consumes. presignUrl() is the
 * public export that carries the signed parts, and its PUT URL shape is
 * stable: the control-plane URL + `pathname` + the signed `vercel-blob-*`
 * query params. Throws (never mints a broken grant) if the signed parts are
 * missing.
 */
export function presignedPutUrlToPayload(url: string): PresignedUploadPayload {
  const u = new URL(url);
  const delegationToken = u.searchParams.get("vercel-blob-delegation");
  const signature = u.searchParams.get("vercel-blob-signature");
  if (!delegationToken || !signature) {
    throw new Error("presigned URL is missing its delegation token or signature");
  }
  const params: Record<string, string> = {};
  for (const [k, v] of u.searchParams) {
    if (k === "pathname" || k === "vercel-blob-delegation" || k === "vercel-blob-signature") {
      continue;
    }
    params[k] = v;
  }
  return { delegationToken, signature, params };
}

/**
 * Mint a direct-to-Blob upload grant for ONE exact key. Scope mirrors the
 * HMAC capability that authorizes minting it: one key, "put" only, the same
 * 15-minute TTL, and the app's 25MB size cap — all signed server-side, so the
 * browser can't widen any of it.
 */
export async function createClientUploadGrant(
  key: string
): Promise<PresignedUploadPayload> {
  const validUntil = Date.now() + CAP_TTL_MS;
  if (testStore) {
    const grant = testStore.grantClientUpload(key, MAX_UPLOAD_BYTES, validUntil);
    return {
      delegationToken: grant.delegationToken,
      signature: "test-signature",
      params: {},
    };
  }
  const signedToken = await issueSignedToken({
    pathname: key,
    operations: ["put"],
    validUntil,
    maximumSizeInBytes: MAX_UPLOAD_BYTES,
    ...auth(),
  });
  const { presignedUrl } = await presignUrl(signedToken, {
    operation: "put",
    pathname: key,
    access: ACCESS,
    // Mirror putBlob: keys already carry a timestamp prefix for uniqueness,
    // and reads resolve blobs by exact key (no random suffix).
    allowOverwrite: true,
    addRandomSuffix: false,
  });
  return presignedPutUrlToPayload(presignedUrl);
}

// ---------------------------------------------------------------------------
// Object operations
// ---------------------------------------------------------------------------
export async function putBlob(
  key: string,
  bytes: Uint8Array,
  contentType: string
): Promise<void> {
  if (testStore) {
    if (testStore.failPut?.(key)) throw new Error("blob put failed (test)");
    testStore.puts.push({ key, bytes, contentType });
    testStore.seed(key, bytes, contentType);
    return;
  }
  await put(key, Buffer.from(bytes), {
    access: ACCESS,
    contentType,
    addRandomSuffix: false, // pathname === key, so reads can resolve it by key
    allowOverwrite: true,
    ...auth(),
  });
}

export async function getBlobBytes(key: string): Promise<Uint8Array> {
  if (testStore) return testStore.bytesFor(key);
  // Authenticated read of a private blob — the SDK sets the auth header and
  // streams from origin (useCache:false avoids any read-after-write CDN lag, since
  // the confirm route reads bytes immediately after the upload PUT).
  const r = await get(key, { access: ACCESS, useCache: false, ...auth() });
  if (!r || !r.stream) throw new Error(`blob not found: ${key}`);
  return new Uint8Array(await new Response(r.stream).arrayBuffer());
}

export async function getBlobSize(key: string): Promise<number> {
  if (testStore) return testStore.sizeFor(key);
  // head() is the cheap metadata read (no body) — throws if the blob is missing,
  // mirroring S3 HeadObject so the caller's not-found handling is unchanged.
  return (await head(key, { ...auth() })).size;
}

/** The stored content-type — used by the download proxy to set the response header. */
export async function getBlobContentType(key: string): Promise<string> {
  if (testStore) return testStore.contentTypeFor(key);
  return (await head(key, { ...auth() })).contentType ?? "application/octet-stream";
}

export async function deleteBlob(key: string): Promise<void> {
  if (testStore) {
    if (testStore.failDeletes) throw new Error("blob delete failed (test)");
    testStore.deletes.push(key);
    testStore.seeded.delete(key);
    return;
  }
  // del() wants the URL; resolve it via head() first. Best-effort (deleteObject
  // wraps this in try/catch), so a missing blob is a no-op.
  const h = await head(key, { ...auth() });
  await del(h.url, { ...auth() });
}
