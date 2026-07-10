import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { PUT as blobPut } from "@/app/api/storage/blob-put/route";
import { GET as blobGet } from "@/app/api/storage/blob-get/route";
import { getUploadUrl, getDownloadUrl } from "@/lib/s3";
import {
  setStorageForTesting,
  type TestStorage,
  blobUploadPath,
  blobDownloadPath,
  verifyUpload,
  verifyDownload,
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
