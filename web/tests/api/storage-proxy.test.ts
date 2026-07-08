import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PUT as blobPut } from "@/app/api/storage/blob-put/route";
import { GET as blobGet } from "@/app/api/storage/blob-get/route";
import { getUploadUrl, getDownloadUrl } from "@/lib/s3";
import { setStorageForTesting, type TestStorage } from "@/lib/blob-storage";

// The capability-URL proxy is the private-store equivalent of an S3 pre-signed
// PUT/GET: an authed route issues a short-lived HMAC capability, and these bearer-free
// proxy routes verify it before moving bytes. This locks in the round trip and the
// security rejections (bad prefix, tampered/expired sig, cross-action replay).

let storage: TestStorage;

beforeEach(() => {
  storage = setStorageForTesting()!;
});

afterEach(() => {
  setStorageForTesting(false);
});

const KEY = "deals/deal-1/1700000000/contract.pdf";
const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

function putReq(url: string, body: Uint8Array, contentType = "application/pdf"): Request {
  return new Request(`http://localhost${url}`, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: body as unknown as BodyInit,
  });
}
function getReq(url: string): Request {
  return new Request(`http://localhost${url}`, { method: "GET" });
}

describe("storage capability proxy round trip", () => {
  it("uploads via a put capability, then downloads the same bytes via a get capability", async () => {
    const uploadUrl = await getUploadUrl({ key: KEY, contentType: "application/pdf" });
    expect(uploadUrl).toMatch(/^\/api\/storage\/blob-put\?/);
    const putRes = await blobPut(putReq(uploadUrl, BYTES));
    expect(putRes.status).toBe(200);
    // The bytes actually landed in the backend under the exact key.
    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0].key).toBe(KEY);

    const downloadUrl = await getDownloadUrl({ key: KEY });
    expect(downloadUrl).toMatch(/^\/api\/storage\/blob-get\?/);
    const getRes = await blobGet(getReq(downloadUrl));
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("content-type")).toBe("application/pdf");
    expect(getRes.headers.get("content-disposition")).toContain("contract.pdf");
    const back = new Uint8Array(await getRes.arrayBuffer());
    expect(Array.from(back)).toEqual(Array.from(BYTES));
  });

  it("blob-put rejects a key outside the allowed namespaces", async () => {
    // Forge a capability for a bad key using the same signer the route trusts.
    const url = (await getUploadUrl({ key: KEY })).replace(
      encodeURIComponent(KEY),
      encodeURIComponent("secrets/passwd")
    );
    const res = await blobPut(putReq(url, BYTES));
    // Either the prefix guard (400) or the sig check (403) rejects it — never 200.
    expect([400, 403]).toContain(res.status);
    expect(storage.puts).toHaveLength(0);
  });

  it("blob-put enforces the size cap", async () => {
    const uploadUrl = await getUploadUrl({ key: KEY });
    const tooBig = new Uint8Array(26 * 1024 * 1024); // > 25MB cap
    const res = await blobPut(putReq(uploadUrl, tooBig));
    expect(res.status).toBe(413);
  });

  it("blob-get rejects a tampered signature", async () => {
    storage.seed(KEY, BYTES);
    const url = await getDownloadUrl({ key: KEY });
    const tampered = url.replace(/sig=([0-9a-f]+)/, (_m, sig: string) => {
      const flipped = sig[0] === "0" ? "1" : "0";
      return `sig=${flipped}${sig.slice(1)}`;
    });
    const res = await blobGet(getReq(tampered));
    expect(res.status).toBe(403);
  });

  it("blob-get rejects an expired capability", async () => {
    storage.seed(KEY, BYTES);
    const url = await getDownloadUrl({ key: KEY });
    const expired = url.replace(/exp=\d+/, "exp=1");
    const res = await blobGet(getReq(expired));
    expect(res.status).toBe(403);
  });

  it("a put capability cannot be replayed against blob-get (action-namespaced)", async () => {
    storage.seed(KEY, BYTES);
    // Take an upload capability and point it at the download route.
    const uploadUrl = await getUploadUrl({ key: KEY });
    const asDownload = uploadUrl.replace("/blob-put?", "/blob-get?");
    const res = await blobGet(getReq(asDownload));
    expect(res.status).toBe(403);
  });

  it("a get capability cannot be replayed against blob-put", async () => {
    const downloadUrl = await getDownloadUrl({ key: KEY });
    const asUpload = downloadUrl.replace("/blob-get?", "/blob-put?");
    const res = await blobPut(putReq(asUpload, BYTES));
    expect(res.status).toBe(403);
    expect(storage.puts).toHaveLength(0);
  });
});
