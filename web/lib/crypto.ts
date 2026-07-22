/**
 * Field-level encryption for at-rest secrets (#273).
 *
 * App-level envelope encryption with AES-256-GCM, keyed by the FIELD_ENCRYPTION_KEY
 * env var. Today it protects each agent's SimplyRETS MLS credentials
 * (users.mls_key / users.mls_secret) — plaintext at rest means anyone with DB
 * read access (leaked backup, compromised connection string, a future
 * SQL-exposure bug) gets every agent's live MLS secret. Encrypting at the app
 * layer keeps the ciphertext opaque to the database.
 *
 * ── Stored format ────────────────────────────────────────────────────────────
 *   enc:v1:<base64(iv)>.<base64(authTag)>.<base64(ciphertext)>
 *
 *   - "enc:v1:"  a self-describing version tag. Its PRESENCE is how the
 *                decrypt path tells ciphertext from legacy plaintext (see below);
 *                the "v1" lets a future scheme (v2, key rotation) coexist.
 *   - iv         a fresh random 12-byte IV per encryption (GCM's nonce; never
 *                reused under the same key).
 *   - authTag    the 16-byte GCM authentication tag — verified on decrypt, so
 *                any tampering with the stored value makes decryption throw.
 *   - ciphertext AES-256-GCM ciphertext of the UTF-8 plaintext.
 *   The three parts are base64 and dot-joined; base64 never contains "." so the
 *   split is unambiguous. The ciphertext fits the existing String? columns, so
 *   NO schema change is needed.
 *
 * ── Transparent legacy-plaintext reads (NO migration / backfill) ──────────────
 *   decryptField() treats a value WITHOUT the "enc:v1:" prefix as legacy
 *   plaintext and returns it unchanged. Existing plaintext rows keep working
 *   until the agent next re-saves (which stores ciphertext). Legacy passthrough
 *   does NOT require a key to be configured, so reads stay resilient during
 *   rollout.
 *
 * ── Test seam ─────────────────────────────────────────────────────────────────
 *   setCryptoForTesting(impl) injects a deterministic FieldCrypto (build one with
 *   createFieldCrypto(parseFieldKey(<fixed hex/base64 key>))) so tests round-trip
 *   real AES-GCM under a fixed key and never depend on a real FIELD_ENCRYPTION_KEY.
 *   Mirrors the setXForTesting seam used by lib/stripe.ts, lib/simplyrets.ts, etc.
 */
import crypto from "node:crypto";
import { env } from "./env";

/** Version-tagged prefix marking an app-encrypted value. */
export const ENC_PREFIX = "enc:v1:";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce length

export type FieldCrypto = {
  /** Encrypt UTF-8 plaintext → an "enc:v1:..." tagged string. */
  encryptField(plaintext: string): string;
  /**
   * Decrypt an "enc:v1:..." value → plaintext. A value WITHOUT the prefix is
   * treated as legacy plaintext and returned unchanged (transparent passthrough).
   */
  decryptField(stored: string): string;
};

/**
 * Parse a 32-byte key from FIELD_ENCRYPTION_KEY. Accepts either 64 hex chars
 * (e.g. `openssl rand -hex 32`) or a base64-encoded 32-byte key. Throws a clear
 * config error if the value decodes to anything other than 32 bytes.
 */
export function parseFieldKey(raw: string): Buffer {
  const trimmed = raw.trim();
  let key: Buffer;
  // A strict 64-char hex string is unambiguously the hex form. Anything else is
  // treated as base64 (Node's base64 decoder is lenient, so the length check
  // below is the real guard against a malformed value).
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    key = Buffer.from(trimmed, "hex");
  } else {
    key = Buffer.from(trimmed, "base64");
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `FIELD_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). ` +
        `Provide 64 hex chars (e.g. \`openssl rand -hex 32\`) or a base64-encoded ` +
        `32-byte key.`
    );
  }
  return key;
}

/**
 * Build a FieldCrypto bound to a specific 32-byte key. Exported so tests can
 * inject a deterministic impl via setCryptoForTesting, and so key parsing/impl
 * construction are unit-testable without env.
 */
export function createFieldCrypto(key: Buffer): FieldCrypto {
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `field-encryption key must be ${KEY_BYTES} bytes (got ${key.length})`
    );
  }
  return {
    encryptField(plaintext: string): string {
      const iv = crypto.randomBytes(IV_BYTES);
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();
      return (
        ENC_PREFIX +
        [
          iv.toString("base64"),
          authTag.toString("base64"),
          ciphertext.toString("base64"),
        ].join(".")
      );
    },
    decryptField(stored: string): string {
      if (!stored.startsWith(ENC_PREFIX)) {
        // Legacy plaintext — return untouched (transparent passthrough).
        return stored;
      }
      const payload = stored.slice(ENC_PREFIX.length);
      const parts = payload.split(".");
      if (parts.length !== 3) {
        throw new Error("malformed enc:v1: value (expected iv.tag.ciphertext)");
      }
      const [ivB64, tagB64, ctB64] = parts;
      const iv = Buffer.from(ivB64, "base64");
      const authTag = Buffer.from(tagB64, "base64");
      const ciphertext = Buffer.from(ctB64, "base64");
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag); // GCM verifies this on final() → tamper throws
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      return plaintext.toString("utf8");
    },
  };
}

let stub: FieldCrypto | undefined;
let real: FieldCrypto | undefined;

/**
 * Test seam — inject a deterministic FieldCrypto (or undefined to restore the
 * env-backed default). Also drops the cached real impl so a later env change is
 * observed.
 */
export function setCryptoForTesting(impl: FieldCrypto | undefined): void {
  stub = impl;
  real = undefined;
}

/** The active crypto impl: an injected stub, or the env-key-backed default. */
function activeCrypto(): FieldCrypto {
  if (stub) return stub;
  if (!real) {
    const raw = env().FIELD_ENCRYPTION_KEY;
    if (!raw) {
      throw new Error(
        "FIELD_ENCRYPTION_KEY is not configured — cannot encrypt at-rest secrets. " +
          "Set it in the environment (e.g. `openssl rand -hex 32`)."
      );
    }
    real = createFieldCrypto(parseFieldKey(raw));
  }
  return real;
}

/** Encrypt a plaintext field value for storage. */
export function encryptField(plaintext: string): string {
  return activeCrypto().encryptField(plaintext);
}

/**
 * Decrypt a stored field value. A value without the "enc:v1:" prefix is legacy
 * plaintext and is returned unchanged WITHOUT requiring a configured key, so
 * existing plaintext rows keep working during rollout.
 */
export function decryptField(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  return activeCrypto().decryptField(stored);
}
