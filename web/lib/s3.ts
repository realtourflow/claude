/**
 * Object-storage facade — pre-signed-equivalent PUT/GET capability URLs + object
 * read/write/delete. Backed entirely by Vercel Blob (lib/blob-storage); AWS S3 has
 * been retired. The function names keep their historical `S3`/`Object` shape so the
 * ~15 call sites are unchanged; only the backend moved.
 *
 * Key generators are backend-agnostic (a key is just a path) — the `deals/`,
 * `agent-templates/`, and `agent-forms/` prefixes are the three namespaces the
 * upload proxy (/api/storage/blob-put) accepts.
 */
import {
  assertStorageConfigured,
  blobUploadPath,
  blobDownloadPath,
  putBlob,
  getBlobBytes,
  getBlobSize,
  deleteBlob,
} from "./blob-storage";

/** Generates a deal-scoped storage key with a timestamp prefix to avoid collisions. */
export function makeS3Key(dealId: string, fileName: string): string {
  const safe = fileName.split("/").pop()!.replace(/\s+/g, "-");
  return `deals/${dealId}/${Date.now()}/${safe}`;
}

/**
 * Generates an agent-scoped storage key for a doc template, with a timestamp prefix
 * to avoid collisions. Mirrors agentDocS3Key in the legacy Go backend.
 */
export function makeAgentDocS3Key(agentId: string, fileName: string): string {
  const safe = fileName.split("/").pop()!.replace(/\s+/g, "-");
  return `agent-templates/${agentId}/${Date.now()}/${safe}`;
}

/**
 * Generates an agent-scoped storage key for an uploaded form (the form-upload
 * pipeline), with a timestamp prefix. Separate `agent-forms/` namespace so it
 * never collides with doc templates (`agent-templates/`) or deal docs.
 */
export function makeAgentFormS3Key(agentId: string, fileName: string): string {
  const safe = fileName.split("/").pop()!.replace(/\s+/g, "-");
  return `agent-forms/${agentId}/${Date.now()}/${safe}`;
}

/**
 * A capability URL the client PUTs the file to. The content-type is sent by the
 * client on the PUT itself (the blob-put proxy reads it from the request), so the
 * `contentType` arg is accepted for call-site compatibility but not baked into the URL.
 */
export async function getUploadUrl(input: {
  key: string;
  contentType?: string;
}): Promise<string> {
  assertStorageConfigured();
  return blobUploadPath(input.key);
}

/** A capability URL the browser opens to download the file. */
export async function getDownloadUrl(input: { key: string }): Promise<string> {
  assertStorageConfigured();
  return blobDownloadPath(input.key);
}

/**
 * Fetches the full object body as bytes. Used to hand a document's contents to
 * DocuSign / the PDF renderer.
 */
export async function getObjectBytes(key: string): Promise<Uint8Array> {
  return getBlobBytes(key);
}

/**
 * Object size in bytes (cheap metadata — no body download). Used to reject an
 * oversized upload BEFORE buffering/parsing it.
 */
export async function getObjectSize(key: string): Promise<number> {
  return getBlobSize(key);
}

/**
 * Uploads bytes directly to storage (server-side put, no capability URL). Used to
 * store server-generated files such as merged disclosure packets.
 */
export async function putObjectBytes(
  key: string,
  bytes: Uint8Array,
  contentType: string
): Promise<void> {
  await putBlob(key, bytes, contentType);
}

/** Best-effort delete. Logs and swallows errors. */
export async function deleteObject(key: string): Promise<void> {
  try {
    await deleteBlob(key);
  } catch (err) {
    console.warn("object delete failed (ignored)", { key, err });
  }
}
