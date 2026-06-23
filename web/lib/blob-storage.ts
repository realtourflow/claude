/**
 * Vercel Blob storage backend — used in the PREVIEW environment so the upload→vision
 * →overlay flow never needs AWS. lib/s3 dispatches to these when a Blob store is
 * configured (Preview only); production has no store wired into this code path (and
 * an env guard below blocks it regardless), so it keeps using S3 untouched.
 *
 * Auth: supports BOTH Vercel Blob modes — a static BLOB_READ_WRITE_TOKEN, OR (the
 * newer store model) OIDC: the SDK exchanges the deployment's VERCEL_OIDC_TOKEN +
 * BLOB_STORE_ID when no token is passed. So we pass `token` only when we actually
 * have one, and otherwise let the SDK use OIDC.
 *
 * Blob has no native pre-signed PUT, so client-direct uploads go through a tiny proxy
 * route (/api/storage/blob-put) authorized by an HMAC capability over the key — the
 * same shape as an S3 pre-signed PUT, signed with a server-only secret.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { put, list, del } from "@vercel/blob";
import { env } from "./env";

export function blobEnabled(): boolean {
  // A store is configured if either auth mode is available. NEVER in production —
  // even if a store got connected there, production file storage stays 100% on S3.
  const e = env();
  return !!(e.BLOB_READ_WRITE_TOKEN || e.BLOB_STORE_ID) && e.VERCEL_ENV !== "production";
}

// SDK auth: pass the static R/W token if we have one; otherwise pass nothing so the
// SDK falls back to OIDC (VERCEL_OIDC_TOKEN + BLOB_STORE_ID) automatically.
function auth(): { token?: string } {
  const t = env().BLOB_READ_WRITE_TOKEN;
  return t ? { token: t } : {};
}

// HMAC secret for the upload capability — a server-only value present in either auth
// mode (the R/W token, else the store id). Never exposed to the client.
function hmacSecret(): string {
  const e = env();
  return e.BLOB_READ_WRITE_TOKEN || e.BLOB_STORE_ID;
}

const UPLOAD_TTL_MS = 15 * 60 * 1000;

function sign(key: string, exp: number): string {
  return createHmac("sha256", hmacSecret()).update(`${key}|${exp}`).digest("hex");
}

/** A capability URL the client PUTs the file to (mirrors getUploadUrl's pre-signed URL). */
export function blobUploadPath(key: string): string {
  const exp = Date.now() + UPLOAD_TTL_MS;
  return `/api/storage/blob-put?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sign(key, exp)}`;
}

/** Verify a capability (timing-safe + not expired). */
export function verifyUpload(key: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = Buffer.from(sign(key, exp));
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export async function putBlob(
  key: string,
  bytes: Uint8Array,
  contentType: string
): Promise<void> {
  await put(key, Buffer.from(bytes), {
    access: "public",
    contentType,
    addRandomSuffix: false, // pathname === key, so reads can resolve it
    allowOverwrite: true,
    ...auth(),
  });
}

// Resolve a key to its blob (pathname === key since addRandomSuffix is off).
async function find(key: string): Promise<{ url: string; size: number } | null> {
  const { blobs } = await list({ prefix: key, limit: 1, ...auth() });
  const b = blobs.find((x) => x.pathname === key) ?? blobs[0];
  return b ? { url: b.url, size: b.size } : null;
}

export async function getBlobBytes(key: string): Promise<Uint8Array> {
  const b = await find(key);
  if (!b) throw new Error(`blob not found: ${key}`);
  const res = await fetch(b.url);
  if (!res.ok) throw new Error(`blob fetch ${key}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function getBlobSize(key: string): Promise<number> {
  return (await find(key))?.size ?? 0;
}

export async function getBlobUrl(key: string): Promise<string> {
  const b = await find(key);
  if (!b) throw new Error(`blob not found: ${key}`);
  return b.url;
}

export async function deleteBlob(key: string): Promise<void> {
  const b = await find(key);
  if (b) await del(b.url, { ...auth() });
}
