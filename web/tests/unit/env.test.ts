/**
 * Env-schema validation tests (T14, #82) — fail-closed OAUTH_STATE_SECRET.
 *
 * OAUTH_STATE_SECRET signs the calendar-OAuth CSRF state cookie
 * (lib/oauth-state.ts). Outside Vercel production it may fall back to the
 * committed dev value so local dev / CI / previews stay zero-config — but in
 * production (VERCEL_ENV=production) that public fallback would let anyone
 * forge state, so env() must throw loudly instead.
 *
 * Every case saves/restores the touched vars and calls resetEnvForTesting()
 * so nothing leaks into other test files (env() caches its parse).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env, resetEnvForTesting } from "@/lib/env";

const ENV_KEYS = [
  "OAUTH_STATE_SECRET",
  "VERCEL_ENV",
  "DOCUSIGN_CONNECT_HMAC_KEY",
  "BLOB_CAP_SECRET",
] as const;

// Must match the committed fallbacks in lib/env.ts.
const DEV_FALLBACK = "rtf-dev-oauth-state-secret-change-in-prod";
const DEV_BLOB_CAP_FALLBACK = "rtf-dev-blob-cap-secret-change-in-prod";
const STRONG_SECRET = "0123456789abcdef0123456789abcdef"; // exactly 32 chars

let saved: Record<string, string | undefined>;

beforeEach(() => {
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

describe("env() OAUTH_STATE_SECRET", () => {
  describe("without VERCEL_ENV (local dev, vitest, CI)", () => {
    it("falls back to the dev secret when unset", () => {
      expect(env().OAUTH_STATE_SECRET).toBe(DEV_FALLBACK);
    });

    it("falls back to the dev secret when explicitly empty", () => {
      process.env.OAUTH_STATE_SECRET = "";
      expect(env().OAUTH_STATE_SECRET).toBe(DEV_FALLBACK);
    });

    it("uses the provided value when set", () => {
      process.env.OAUTH_STATE_SECRET = STRONG_SECRET;
      expect(env().OAUTH_STATE_SECRET).toBe(STRONG_SECRET);
    });
  });

  describe("on a Vercel preview (VERCEL_ENV=preview)", () => {
    it("keeps the dev fallback — previews stay zero-config", () => {
      process.env.VERCEL_ENV = "preview";
      expect(env().OAUTH_STATE_SECRET).toBe(DEV_FALLBACK);
    });
  });

  describe("in Vercel production (VERCEL_ENV=production)", () => {
    beforeEach(() => {
      process.env.VERCEL_ENV = "production";
    });

    it("throws when unset, with a message naming OAUTH_STATE_SECRET", () => {
      expect(() => env()).toThrowError(/OAUTH_STATE_SECRET/);
    });

    it("throws when explicitly empty", () => {
      process.env.OAUTH_STATE_SECRET = "";
      expect(() => env()).toThrowError(/OAUTH_STATE_SECRET/);
    });

    it("throws when shorter than 32 characters", () => {
      process.env.OAUTH_STATE_SECRET = "too-short-secret";
      expect(() => env()).toThrowError(/OAUTH_STATE_SECRET/);
    });

    it("never silently substitutes the committed dev fallback", () => {
      // The fail-open bug this guards against: unset secret + prod must not
      // resolve to DEV_FALLBACK under any circumstances.
      let leaked: string | undefined;
      try {
        leaked = env().OAUTH_STATE_SECRET;
      } catch {
        // expected path
      }
      expect(leaked).toBeUndefined();
    });

    it("accepts a 32+ character secret", () => {
      process.env.OAUTH_STATE_SECRET = STRONG_SECRET;
      // Production also fail-closes on the DocuSign webhook HMAC key (#176)
      // and the Blob capability secret (#188) — satisfy those guards so this
      // case isolates OAUTH_STATE_SECRET.
      process.env.DOCUSIGN_CONNECT_HMAC_KEY = "docusign-connect-hmac-key";
      process.env.BLOB_CAP_SECRET = STRONG_SECRET;
      expect(env().OAUTH_STATE_SECRET).toBe(STRONG_SECRET);
    });

    it("keeps throwing on every call — a failed parse is never cached", () => {
      expect(() => env()).toThrowError(/OAUTH_STATE_SECRET/);
      expect(() => env()).toThrowError(/OAUTH_STATE_SECRET/);
    });
  });
});

describe("env() DOCUSIGN_CONNECT_HMAC_KEY (#176 fail-closed webhook)", () => {
  it("stays optional locally (no VERCEL_ENV) — dev/CI need zero config", () => {
    expect(env().DOCUSIGN_CONNECT_HMAC_KEY).toBe("");
  });

  it("stays optional on previews (VERCEL_ENV=preview)", () => {
    process.env.VERCEL_ENV = "preview";
    expect(env().DOCUSIGN_CONNECT_HMAC_KEY).toBe("");
  });

  describe("in Vercel production (VERCEL_ENV=production)", () => {
    beforeEach(() => {
      process.env.VERCEL_ENV = "production";
      // Satisfy the independent OAUTH_STATE_SECRET + BLOB_CAP_SECRET prod
      // guards so these cases isolate the DocuSign key.
      process.env.OAUTH_STATE_SECRET = STRONG_SECRET;
      process.env.BLOB_CAP_SECRET = STRONG_SECRET;
    });

    it("throws when unset, with a message naming DOCUSIGN_CONNECT_HMAC_KEY", () => {
      expect(() => env()).toThrowError(/DOCUSIGN_CONNECT_HMAC_KEY/);
    });

    it("throws when explicitly empty", () => {
      process.env.DOCUSIGN_CONNECT_HMAC_KEY = "";
      expect(() => env()).toThrowError(/DOCUSIGN_CONNECT_HMAC_KEY/);
    });

    it("accepts a configured key", () => {
      process.env.DOCUSIGN_CONNECT_HMAC_KEY = "prod-connect-hmac-key";
      expect(env().DOCUSIGN_CONNECT_HMAC_KEY).toBe("prod-connect-hmac-key");
    });
  });
});

describe("env() BLOB_CAP_SECRET (#188 fail-closed Blob capability signing)", () => {
  describe("without VERCEL_ENV (local dev, vitest, CI)", () => {
    it("falls back to the dev secret when unset", () => {
      expect(env().BLOB_CAP_SECRET).toBe(DEV_BLOB_CAP_FALLBACK);
    });

    it("falls back to the dev secret when explicitly empty", () => {
      process.env.BLOB_CAP_SECRET = "";
      expect(env().BLOB_CAP_SECRET).toBe(DEV_BLOB_CAP_FALLBACK);
    });

    it("uses the provided value when set", () => {
      process.env.BLOB_CAP_SECRET = STRONG_SECRET;
      expect(env().BLOB_CAP_SECRET).toBe(STRONG_SECRET);
    });
  });

  describe("on a Vercel preview (VERCEL_ENV=preview)", () => {
    it("keeps the dev fallback — previews stay zero-config", () => {
      process.env.VERCEL_ENV = "preview";
      expect(env().BLOB_CAP_SECRET).toBe(DEV_BLOB_CAP_FALLBACK);
    });
  });

  describe("in Vercel production (VERCEL_ENV=production)", () => {
    beforeEach(() => {
      process.env.VERCEL_ENV = "production";
      // Satisfy the independent prod guards so these cases isolate
      // BLOB_CAP_SECRET.
      process.env.OAUTH_STATE_SECRET = STRONG_SECRET;
      process.env.DOCUSIGN_CONNECT_HMAC_KEY = "docusign-connect-hmac-key";
    });

    it("throws when unset, with a message naming BLOB_CAP_SECRET", () => {
      expect(() => env()).toThrowError(/BLOB_CAP_SECRET/);
    });

    it("throws when explicitly empty", () => {
      process.env.BLOB_CAP_SECRET = "";
      expect(() => env()).toThrowError(/BLOB_CAP_SECRET/);
    });

    it("throws when shorter than 32 characters", () => {
      process.env.BLOB_CAP_SECRET = "too-short-secret";
      expect(() => env()).toThrowError(/BLOB_CAP_SECRET/);
    });

    it("never silently substitutes the committed dev fallback (or the store id)", () => {
      // The fail-open bug this guards against (#188): unset secret + prod
      // must throw — not resolve to the dev fallback, and hmacSecret() must
      // never get a chance to degrade to BLOB_STORE_ID.
      let leaked: string | undefined;
      try {
        leaked = env().BLOB_CAP_SECRET;
      } catch {
        // expected path
      }
      expect(leaked).toBeUndefined();
    });

    it("accepts a 32+ character secret", () => {
      process.env.BLOB_CAP_SECRET = STRONG_SECRET;
      expect(env().BLOB_CAP_SECRET).toBe(STRONG_SECRET);
    });
  });
});
