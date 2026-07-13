import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { PUT as blobPut } from "@/app/api/storage/blob-put/route";
import { GET as blobGet } from "@/app/api/storage/blob-get/route";
import { POST as clientUpload } from "@/app/api/storage/client-upload/route";
import { getUploadUrl, getDownloadUrl, getClientUploadUrl } from "@/lib/s3";
import {
  setStorageForTesting,
  type TestStorage,
  blobUploadPath,
  blobDownloadPath,
  verifyUpload,
  verifyDownload,
  presignedPutUrlToPayload,
  MAX_UPLOAD_BYTES,
} from "@/lib/blob-storage";
import { resetEnvForTesting } from "@/lib/env";

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

// ---------------------------------------------------------------------------
// #189 — direct-to-Blob client uploads (presigned grant route).
//
// Vercel rejects request bodies over ~4.5MB at the platform edge, so the
// blob-put proxy can never receive a 5–25MB file in prod. The fix: an authed
// caller mints the SAME HMAC "put" capability as before, but the client
// exchanges it at /api/storage/client-upload for a presigned direct-to-Blob
// PUT grant (SDK issueSignedToken + presignUrl — OIDC-compatible). The token
// route only ever handles a tiny JSON envelope; the file bytes go from the
// browser straight to Blob. These tests lock in:
//   1. the token route never buffers file bytes through a function,
//   2. the capability/ownership/namespace checks still gate the grant, and
//   3. a 10MB upload round-trips through the direct path in the test seam.
// ---------------------------------------------------------------------------
describe("#189 direct client upload (presigned grant route)", () => {
  function mintReq(url: string, body: unknown): Request {
    return new Request(`http://localhost${url}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function mintBody(pathname: string = KEY, multipart = false): unknown {
    // The exact envelope @vercel/blob/client's uploadPresigned() POSTs.
    return {
      type: "blob.generate-presigned-url",
      payload: { pathname, multipart, clientPayload: null },
    };
  }

  it("mints a presigned grant without ever buffering file bytes through the function", async () => {
    const url = await getClientUploadUrl({ key: KEY });
    expect(url).toMatch(/^\/api\/storage\/client-upload\?/);

    const res = await clientUpload(mintReq(url, mintBody()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      type: string;
      presignedUrlPayload: { delegationToken: string; signature: string; params: Record<string, string> };
    };
    expect(body.type).toBe("blob.generate-presigned-url");
    expect(body.presignedUrlPayload.delegationToken).toBeTruthy();

    // The token route handled a tiny JSON envelope only — no file bytes flowed
    // through the function (nothing was written via the server-side backend).
    expect(storage.puts).toHaveLength(0);
    expect(storage.reads).toHaveLength(0);
  });

  it("the grant pins the exact key and the 25MB cap (capability semantics preserved)", async () => {
    const url = await getClientUploadUrl({ key: KEY });
    await clientUpload(mintReq(url, mintBody()));

    expect(storage.clientUploadGrants).toHaveLength(1);
    expect(storage.clientUploadGrants[0].key).toBe(KEY);
    expect(storage.clientUploadGrants[0].maximumSizeInBytes).toBe(MAX_UPLOAD_BYTES);
    expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
    expect(storage.clientUploadGrants[0].validUntil).toBeGreaterThan(Date.now());
  });

  it("rejects a key outside the allowed namespaces", async () => {
    const url = (await getClientUploadUrl({ key: KEY })).replace(
      encodeURIComponent(KEY),
      encodeURIComponent("secrets/passwd")
    );
    const res = await clientUpload(mintReq(url, mintBody("secrets/passwd")));
    expect([400, 403]).toContain(res.status);
    expect(storage.clientUploadGrants).toHaveLength(0);
  });

  it("rejects a tampered signature", async () => {
    const url = (await getClientUploadUrl({ key: KEY })).replace(
      /sig=([0-9a-f]+)/,
      (_m, sig: string) => `sig=${sig[0] === "0" ? "1" : "0"}${sig.slice(1)}`
    );
    const res = await clientUpload(mintReq(url, mintBody()));
    expect(res.status).toBe(403);
    expect(storage.clientUploadGrants).toHaveLength(0);
  });

  it("rejects an expired capability", async () => {
    const url = (await getClientUploadUrl({ key: KEY })).replace(/exp=\d+/, "exp=1");
    const res = await clientUpload(mintReq(url, mintBody()));
    expect(res.status).toBe(403);
    expect(storage.clientUploadGrants).toHaveLength(0);
  });

  it("a download (get) capability cannot mint an upload grant (action-namespaced)", async () => {
    const asMint = (await getDownloadUrl({ key: KEY })).replace(
      "/api/storage/blob-get?",
      "/api/storage/client-upload?"
    );
    const res = await clientUpload(mintReq(asMint, mintBody()));
    expect(res.status).toBe(403);
    expect(storage.clientUploadGrants).toHaveLength(0);
  });

  it("rejects a body pathname that does not match the capability's pinned key", async () => {
    const url = await getClientUploadUrl({ key: KEY });
    const res = await clientUpload(
      mintReq(url, mintBody("deals/deal-1/1700000000/other.pdf"))
    );
    expect([400, 403]).toContain(res.status);
    expect(storage.clientUploadGrants).toHaveLength(0);
  });

  it("rejects multipart grant requests (25MB cap never needs them)", async () => {
    const url = await getClientUploadUrl({ key: KEY });
    const res = await clientUpload(mintReq(url, mintBody(KEY, true)));
    expect(res.status).toBe(400);
    expect(storage.clientUploadGrants).toHaveLength(0);
  });

  it("rejects a malformed or wrong-type body", async () => {
    const url = await getClientUploadUrl({ key: KEY });
    expect((await clientUpload(mintReq(url, { type: "blob.upload-completed" }))).status).toBe(400);
    expect(
      (
        await clientUpload(
          new Request(`http://localhost${url}`, { method: "POST", body: "not json" })
        )
      ).status
    ).toBe(400);
    expect(storage.clientUploadGrants).toHaveLength(0);
  });

  it("a 10MB upload round-trips through the direct path (test seam)", async () => {
    // 10MB would be impossible through a Vercel Function (~4.5MB edge cap) —
    // the whole point of #189. In the seam the browser's direct PUT is
    // storage.directPut against the minted grant.
    const url = await getClientUploadUrl({ key: KEY });
    const res = await clientUpload(mintReq(url, mintBody()));
    const { presignedUrlPayload } = (await res.json()) as {
      presignedUrlPayload: { delegationToken: string };
    };

    const tenMB = new Uint8Array(10 * 1024 * 1024);
    for (let i = 0; i < tenMB.length; i += 4096) tenMB[i] = i % 251;
    storage.directPut(presignedUrlPayload.delegationToken, tenMB, "application/pdf");

    const dl = await blobGet(getReq(await getDownloadUrl({ key: KEY })));
    expect(dl.status).toBe(200);
    const back = new Uint8Array(await dl.arrayBuffer());
    expect(back.byteLength).toBe(tenMB.byteLength);
    expect(Buffer.compare(Buffer.from(back), Buffer.from(tenMB))).toBe(0);
  });

  it("the storage side enforces the signed 25MB cap on the direct path", async () => {
    const url = await getClientUploadUrl({ key: KEY });
    const res = await clientUpload(mintReq(url, mintBody()));
    const { presignedUrlPayload } = (await res.json()) as {
      presignedUrlPayload: { delegationToken: string };
    };

    const tooBig = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    expect(() =>
      storage.directPut(presignedUrlPayload.delegationToken, tooBig, "application/pdf")
    ).toThrowError(/too large|maximum/i);
    expect(storage.seeded.has(KEY)).toBe(false);
  });

  it("a direct PUT without a minted grant is rejected by the storage side", () => {
    expect(() =>
      storage.directPut("forged-delegation-token", BYTES, "application/pdf")
    ).toThrowError(/grant|delegation/i);
  });

  it("presignedPutUrlToPayload round-trips the SDK's presigned PUT URL shape", () => {
    const url =
      "https://blob.vercel-storage.com/?pathname=deals%2Fdeal-1%2Fx.pdf" +
      "&vercel-blob-valid-until=1700000000000" +
      "&vercel-blob-maximum-size-in-bytes=26214400" +
      "&vercel-blob-delegation=eyJwYXlsb2FkIjoi.sig" +
      "&vercel-blob-signature=abc123";
    const payload = presignedPutUrlToPayload(url);
    expect(payload.delegationToken).toBe("eyJwYXlsb2FkIjoi.sig");
    expect(payload.signature).toBe("abc123");
    expect(payload.params).toEqual({
      "vercel-blob-valid-until": "1700000000000",
      "vercel-blob-maximum-size-in-bytes": "26214400",
    });
    // A URL missing the signed parts must throw, never mint a broken grant.
    expect(() =>
      presignedPutUrlToPayload("https://blob.vercel-storage.com/?pathname=x")
    ).toThrowError(/delegation|signature/i);
  });
});

// ---------------------------------------------------------------------------
// Capability HMAC secret (#188) — signed with BLOB_CAP_SECRET, never the
// store id. These cases run WITHOUT the in-memory test store so hmacSecret()
// goes through the real env-based path (env() is re-read via
// resetEnvForTesting after each process.env mutation). Every rejection path
// asserted here fires before any @vercel/blob SDK call, so no network is
// touched.
// ---------------------------------------------------------------------------
describe("capability HMAC secret (#188 — dedicated BLOB_CAP_SECRET, store id never signs)", () => {
  const ENV_KEYS = [
    "BLOB_CAP_SECRET",
    "BLOB_READ_WRITE_TOKEN",
    "BLOB_STORE_ID",
    "VERCEL_ENV",
    "OAUTH_STATE_SECRET",
    "DOCUSIGN_CONNECT_HMAC_KEY",
  ] as const;

  const CAP_SECRET = "cap-secret-0123456789abcdef0123456789abcdef"; // 32+ chars
  const STORE_ID = "store_abc123nonsecret"; // visible identifier, NOT a secret
  const RW_TOKEN = "vercel_blob_rw_store_abc123_faketoken";
  const STRONG_OAUTH_SECRET = "0123456789abcdef0123456789abcdef"; // satisfies prod guard

  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    // Tear down the store the outer beforeEach installed — with a test store
    // active, hmacSecret() short-circuits to a fixed test value and would
    // never exercise the env-based secret under test here.
    setStorageForTesting(false);
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    resetEnvForTesting();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetEnvForTesting();
  });

  /** Forge a capability query string signed with an arbitrary key. */
  function forge(action: "put" | "get", secret: string, exp: number): string {
    const sig = createHmac("sha256", secret)
      .update(`${action}|${KEY}|${exp}`)
      .digest("hex");
    return `key=${encodeURIComponent(KEY)}&exp=${exp}&sig=${sig}`;
  }

  describe("production-mode config validation (fails closed)", () => {
    beforeEach(() => {
      process.env.VERCEL_ENV = "production";
      // Satisfy the unrelated prod guards so failures isolate BLOB_CAP_SECRET.
      process.env.OAUTH_STATE_SECRET = STRONG_OAUTH_SECRET;
      process.env.DOCUSIGN_CONNECT_HMAC_KEY = "docusign-connect-hmac-key";
      // OIDC mode: store id present, no R/W token — exactly prod's shape.
      process.env.BLOB_STORE_ID = STORE_ID;
      resetEnvForTesting();
    });

    it("with no BLOB_CAP_SECRET, issuing an upload capability throws (never silently signs with the store id)", () => {
      expect(() => blobUploadPath(KEY)).toThrowError(/BLOB_CAP_SECRET/);
    });

    it("with no BLOB_CAP_SECRET, issuing a download capability throws", () => {
      expect(() => blobDownloadPath(KEY)).toThrowError(/BLOB_CAP_SECRET/);
    });

    it("rejects a BLOB_CAP_SECRET shorter than 32 characters", () => {
      process.env.BLOB_CAP_SECRET = "too-short";
      resetEnvForTesting();
      expect(() => blobUploadPath(KEY)).toThrowError(/BLOB_CAP_SECRET/);
    });

    it("signs normally once a 32+ char BLOB_CAP_SECRET is set", () => {
      process.env.BLOB_CAP_SECRET = CAP_SECRET;
      resetEnvForTesting();
      const url = blobUploadPath(KEY);
      const u = new URL(`http://localhost${url}`);
      expect(
        verifyUpload(
          u.searchParams.get("key")!,
          Number(u.searchParams.get("exp")),
          u.searchParams.get("sig")!
        )
      ).toBe(true);
    });
  });

  describe("with BLOB_CAP_SECRET set (store id + token also present)", () => {
    beforeEach(() => {
      process.env.BLOB_CAP_SECRET = CAP_SECRET;
      process.env.BLOB_STORE_ID = STORE_ID;
      process.env.BLOB_READ_WRITE_TOKEN = RW_TOKEN;
      resetEnvForTesting();
    });

    it("sign/verify round-trips for both actions", () => {
      for (const [path, verifyFn, action] of [
        [blobUploadPath(KEY), verifyUpload, "put"],
        [blobDownloadPath(KEY), verifyDownload, "get"],
      ] as const) {
        const u = new URL(`http://localhost${path}`);
        expect(u.pathname).toBe(`/api/storage/blob-${action}`);
        expect(
          verifyFn(
            u.searchParams.get("key")!,
            Number(u.searchParams.get("exp")),
            u.searchParams.get("sig")!
          )
        ).toBe(true);
      }
    });

    it("a URL signed with the store id is rejected", async () => {
      const exp = Date.now() + 60_000;
      const qs = forge("get", STORE_ID, exp);
      expect(verifyDownload(KEY, exp, qs.match(/sig=([0-9a-f]+)/)![1])).toBe(false);
      const res = await blobGet(getReq(`/api/storage/blob-get?${qs}`));
      expect(res.status).toBe(403);
    });

    it("an upload URL signed with the store id is rejected", async () => {
      const exp = Date.now() + 60_000;
      const res = await blobPut(
        putReq(`/api/storage/blob-put?${forge("put", STORE_ID, exp)}`, BYTES)
      );
      expect(res.status).toBe(403);
    });

    it("a URL signed with the R/W token is rejected too — the cap secret is exclusive", async () => {
      const exp = Date.now() + 60_000;
      const res = await blobGet(
        getReq(`/api/storage/blob-get?${forge("get", RW_TOKEN, exp)}`)
      );
      expect(res.status).toBe(403);
    });

    it("expiry is still enforced under the dedicated secret", async () => {
      const exp = Date.now() - 1_000; // correctly signed but already expired
      const qs = forge("get", CAP_SECRET, exp);
      expect(verifyDownload(KEY, exp, qs.match(/sig=([0-9a-f]+)/)![1])).toBe(false);
      const res = await blobGet(getReq(`/api/storage/blob-get?${qs}`));
      expect(res.status).toBe(403);
    });

    it("action namespacing is still enforced under the dedicated secret", async () => {
      const exp = Date.now() + 60_000;
      // A valid PUT capability replayed against the GET route (and vice versa).
      const putQs = forge("put", CAP_SECRET, exp);
      const getQs = forge("get", CAP_SECRET, exp);
      expect((await blobGet(getReq(`/api/storage/blob-get?${putQs}`))).status).toBe(403);
      expect(
        (await blobPut(putReq(`/api/storage/blob-put?${getQs}`, BYTES))).status
      ).toBe(403);
    });

    it("key-namespace guard is still enforced under the dedicated secret", async () => {
      const exp = Date.now() + 60_000;
      const sig = createHmac("sha256", CAP_SECRET)
        .update(`get|secrets/passwd|${exp}`)
        .digest("hex");
      const res = await blobGet(
        getReq(`/api/storage/blob-get?key=${encodeURIComponent("secrets/passwd")}&exp=${exp}&sig=${sig}`)
      );
      expect(res.status).toBe(400);
    });
  });
});
