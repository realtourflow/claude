/**
 * Vercel Blob storage backend — used in the PREVIEW environment so the upload→vision
 * →overlay flow never needs AWS. lib/s3 dispatches to these when BLOB_READ_WRITE_TOKEN
 * is set (Preview only); production has no token, so it keeps using S3 untouched.
 *
 * Blob has no native pre-signed PUT, so client-direct uploads go through a tiny proxy
 * route (/api/storage/blob-put) authorized by an HMAC capability over the key —
 * the same shape as an S3 pre-signed PUT (a short-lived bearer URL scoped to one key),
 * signed with the server-only Blob token so the client never sees a secret.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { put, list, del } from "@vercel/blob";
import { env } from "./env";

export function blobEnabled(): boolean {
  return !!env().BLOB_READ_WRITE_TOKEN;
}

function token(): string {
  return env().BLOB_READ_WRITE_TOKEN;
}

const UPLOAD_TTL_MS = 15 * 60 * 1000;

function sign(key: string, exp: number): string {
  return createHmac("sha256", token()).update(`${key}|${exp}`).digest("hex");
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
    token: token(),
  });
}

// Resolve a key to its blob (pathname === key since addRandomSuffix is off).
async function find(key: string): Promise<{ url: string; size: number } | null> {
  const { blobs } = await list({ prefix: key, limit: 1, token: token() });
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
  if (b) await del(b.url, { token: token() });
}
