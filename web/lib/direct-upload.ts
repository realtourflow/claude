/**
 * Browser-side file upload to storage (#189).
 *
 * Vercel Functions reject request bodies over ~4.5MB at the platform edge, so
 * the blob-put capability proxy silently caps uploads far below the app's
 * advertised 25MB. When the server hands back a `client_upload_url`, the file
 * bytes go BROWSER → BLOB via @vercel/blob/client's presigned flow — no
 * function in the byte path. The capability proxy remains as a fallback for
 * non-size failures (a <4.5MB file still uploads if grant minting hiccups).
 *
 * Failure contract (#190): this helper NEVER throws for an upload failure —
 * it returns { ok:false } so callers can surface an error WITHOUT confirming
 * a phantom documents row.
 */
import { uploadPresigned } from "@vercel/blob/client";

export type StorageUploadResult = {
  ok: boolean;
  /** True when the failure was the 25MB size cap (either path). */
  tooLarge: boolean;
};

// The Blob API rejects a body over the grant's signed maximumSizeInBytes with
// "…the file length cannot be greater than…". Match that (and generic size
// phrasings) so callers can show the specific 25MB message.
function isTooLargeError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /file length cannot be greater|too large|maximum size/i.test(err.message)
  );
}

export async function uploadFileToStorage(input: {
  /** The blob-put capability proxy URL (always present; the fallback path). */
  uploadUrl: string;
  /** The direct-to-Blob grant route URL (preferred byte path when present). */
  clientUploadUrl?: string;
  /** The server-minted storage key the upload is pinned to. */
  key: string;
  file: File | Blob;
  contentType: string;
}): Promise<StorageUploadResult> {
  if (input.clientUploadUrl) {
    try {
      await uploadPresigned(input.key, input.file, {
        access: "private",
        handleUploadUrl: input.clientUploadUrl,
        contentType: input.contentType,
      });
      return { ok: true, tooLarge: false };
    } catch (err) {
      // A size rejection is final — the proxy would refuse it too (413).
      if (isTooLargeError(err)) return { ok: false, tooLarge: true };
      // Anything else degrades to the proxy: better a small-file rescue than
      // a hard outage if grant minting or the Blob API misbehaves.
      console.warn("direct blob upload failed; falling back to proxy", err);
    }
  }
  try {
    const put = await fetch(input.uploadUrl, {
      method: "PUT",
      body: input.file,
      headers: { "Content-Type": input.contentType },
    });
    // fetch does not throw on HTTP errors — a 413/403/500 here means the blob
    // was never written (#190).
    return { ok: put.ok, tooLarge: put.status === 413 };
  } catch {
    return { ok: false, tooLarge: false };
  }
}
