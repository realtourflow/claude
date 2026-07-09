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
import { put, del, head, get } from "@vercel/blob";
import { env } from "./env";

// The store is PRIVATE — see the file header. Writes are private; reads are authed.
const ACCESS = "private" as const;

type StoredBlob = { bytes: Uint8Array; contentType: string };

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
  readonly seeded = new Map<string, StoredBlob>();
  readonly puts: Array<{ key: string; bytes: Uint8Array; contentType: string }> = [];
  readonly deletes: string[] = [];
  /** Keys whose bytes were actually read — lets a test assert bytes were never fetched. */
  readonly reads: string[] = [];

  seed(key: string, bytes: Uint8Array, contentType = "application/pdf"): void {
    this.seeded.set(key, { bytes, contentType });
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

/** Verify an upload capability (timing-safe + not expired). */
export function verifyUpload(key: string, exp: number, sig: string): boolean {
  return verify("put", key, exp, sig);
}

/** Verify a download capability (timing-safe + not expired). */
export function verifyDownload(key: string, exp: number, sig: string): boolean {
  return verify("get", key, exp, sig);
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
