import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET as blobGet } from "@/app/api/storage/blob-get/route";
import { getDownloadUrl } from "@/lib/s3";
import { setStorageForTesting, type TestStorage } from "@/lib/blob-storage";

// #310 — the download proxy used to hard-code `content-disposition: attachment`
// for EVERY file, so PDFs and images always downloaded instead of previewing.
// The fix serves a narrow ALLOWLIST of safe, renderable types inline and forces
// attachment for everything else. The allowlist is deliberately small:
// text/html and image/svg+xml must NEVER be inline (the browser would execute
// them → stored-XSS / drive-by), and unknown types stay attachment too.
//
// These cases go through the real capability-URL flow (getDownloadUrl signs a
// short-lived HMAC; blob-get verifies it) with the in-memory storage seam, so
// no network or real Blob store is touched. Only the disposition header is under
// test; the auth check and streamed bytes are asserted unchanged.

let storage: TestStorage;

beforeEach(() => {
  storage = setStorageForTesting()!;
});

afterEach(() => {
  setStorageForTesting(false);
});

const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"

function getReq(url: string): Request {
  return new Request(`http://localhost${url}`, { method: "GET" });
}

/** Seed a blob of `contentType` under `key`, then GET it through the proxy. */
async function download(key: string, contentType: string): Promise<Response> {
  storage.seed(key, BYTES, contentType);
  const url = await getDownloadUrl({ key });
  return blobGet(getReq(url));
}

describe("blob-get content-disposition (#310 inline preview for safe types)", () => {
  // --- Case 1: PDF previews inline (this FAILED before the fix) ---
  it("serves a PDF inline with its filename so the browser can preview it", async () => {
    const res = await download("deals/deal-1/1700000000/contract.pdf", "application/pdf");
    expect(res.status).toBe(200);
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toMatch(/^inline\s*;/);
    expect(cd).toContain('filename="contract.pdf"');
    expect(cd).not.toContain("attachment");
  });

  // --- Case 2: images preview inline ---
  it.each([
    ["image/png", "photo.png"],
    ["image/jpeg", "scan.jpg"],
    ["image/gif", "clip.gif"],
    ["image/webp", "shot.webp"],
  ])("serves %s inline with its filename", async (type, name) => {
    const res = await download(`deals/deal-1/1700000000/${name}`, type);
    expect(res.status).toBe(200);
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toMatch(/^inline\s*;/);
    expect(cd).toContain(`filename="${name}"`);
  });

  // --- Case 3: unsafe / non-previewable types force download (XSS safety) ---
  it.each([
    ["text/html", "trap.html"], // executable in the browser → never inline
    ["image/svg+xml", "logo.svg"], // SVG can carry <script> → never inline
    ["application/xml", "data.xml"],
    ["text/xml", "feed.xml"],
    ["application/octet-stream", "raw.bin"],
    ["application/zip", "bundle.zip"],
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "deal.docx",
    ],
    [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "budget.xlsx",
    ],
    ["application/msword", "old.doc"],
  ])("forces attachment for %s (not on the inline allowlist)", async (type, name) => {
    const res = await download(`deals/deal-1/1700000000/${name}`, type);
    expect(res.status).toBe(200);
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toMatch(/^attachment\s*;/);
    expect(cd).not.toMatch(/inline/);
    expect(cd).toContain(`filename="${name}"`);
  });

  // html/svg must stay attachment even with a charset param or odd casing — the
  // guard normalizes the type, and it must never be defeated by a variant.
  it.each([
    "text/html; charset=utf-8",
    "TEXT/HTML",
    "image/svg+xml; charset=utf-8",
    "Image/SVG+XML",
  ])("never serves %s inline (normalized XSS guard)", async (type) => {
    const res = await download("deals/deal-1/1700000000/x.html", type);
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toMatch(/^attachment/);
    expect(cd).not.toMatch(/inline/);
  });

  // A safe type is still recognized when it carries a parameter or odd casing.
  it.each([
    "application/pdf; charset=binary",
    "APPLICATION/PDF",
    "image/jpeg; something=1",
  ])("still serves %s inline (params/casing normalized)", async (type) => {
    const res = await download("deals/deal-1/1700000000/f.pdf", type);
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toMatch(/^inline/);
  });

  // Missing/empty content-type must default to attachment (unknown ⇒ download).
  it("forces attachment when the stored content-type is empty/unknown", async () => {
    const res = await download("deals/deal-1/1700000000/mystery", "");
    expect(res.status).toBe(200);
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toMatch(/^attachment/);
  });

  // The disposition change must not disturb the rest of the response: the
  // content-type header, the streamed bytes, and no-store caching are unchanged.
  it("preserves the content-type, streamed bytes, and no-store caching", async () => {
    const key = "deals/deal-1/1700000000/contract.pdf";
    const res = await download(key, "application/pdf");
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const back = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(back)).toEqual(Array.from(BYTES));
  });
});
