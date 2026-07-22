/**
 * Field-level encryption helper (lib/crypto.ts, #273).
 *
 * AES-256-GCM app-level envelope encryption used to protect at-rest secrets
 * (today: users.mls_key / users.mls_secret). These unit tests exercise the
 * primitive directly — round-trip, the self-describing `enc:v1:` format,
 * transparent legacy-plaintext passthrough, GCM tamper detection, and key
 * parsing (hex / base64 / bad length) — without any DB or env dependency.
 */
import { describe, it, expect } from "vitest";
import {
  ENC_PREFIX,
  parseFieldKey,
  createFieldCrypto,
} from "@/lib/crypto";

// A fixed, deterministic 32-byte key (64 hex chars) — tests never touch a real
// FIELD_ENCRYPTION_KEY.
const TEST_KEY_HEX =
  "1111111111111111111111111111111111111111111111111111111111111111";

describe("parseFieldKey", () => {
  it("parses a 64-char hex key to 32 bytes", () => {
    const key = parseFieldKey(TEST_KEY_HEX);
    expect(key).toHaveLength(32);
  });

  it("parses a base64-encoded 32-byte key", () => {
    const raw = Buffer.alloc(32, 7); // 32 bytes of 0x07
    const key = parseFieldKey(raw.toString("base64"));
    expect(key).toHaveLength(32);
    expect(key.equals(raw)).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    const key = parseFieldKey(`  ${TEST_KEY_HEX}\n`);
    expect(key).toHaveLength(32);
  });

  it("throws a clear error when the key decodes to != 32 bytes", () => {
    // 16 base64 bytes, not 32.
    expect(() => parseFieldKey(Buffer.alloc(16).toString("base64"))).toThrowError(
      /32 bytes/
    );
  });

  it("throws on an empty key", () => {
    expect(() => parseFieldKey("")).toThrowError(/32 bytes/);
  });
});

describe("createFieldCrypto", () => {
  it("rejects a key that is not 32 bytes", () => {
    expect(() => createFieldCrypto(Buffer.alloc(16))).toThrowError(/32 bytes/);
  });

  it("round-trips: decryptField(encryptField(x)) === x", () => {
    const crypto = createFieldCrypto(parseFieldKey(TEST_KEY_HEX));
    const plaintext = "my-super-secret-mls-value";
    const enc = crypto.encryptField(plaintext);
    expect(crypto.decryptField(enc)).toBe(plaintext);
  });

  it("emits the self-describing enc:v1: format tag", () => {
    const crypto = createFieldCrypto(parseFieldKey(TEST_KEY_HEX));
    const enc = crypto.encryptField("hello");
    expect(enc.startsWith(ENC_PREFIX)).toBe(true);
    expect(enc).not.toBe("hello");
    // Payload is base64(iv).base64(tag).base64(ciphertext) — three dot-joined parts.
    const parts = enc.slice(ENC_PREFIX.length).split(".");
    expect(parts).toHaveLength(3);
  });

  it("uses a fresh random IV per encryption (same plaintext → different ciphertext)", () => {
    const crypto = createFieldCrypto(parseFieldKey(TEST_KEY_HEX));
    const a = crypto.encryptField("same");
    const b = crypto.encryptField("same");
    expect(a).not.toBe(b);
    expect(crypto.decryptField(a)).toBe("same");
    expect(crypto.decryptField(b)).toBe("same");
  });

  it("passes legacy plaintext (no enc:v1: prefix) through unchanged", () => {
    const crypto = createFieldCrypto(parseFieldKey(TEST_KEY_HEX));
    expect(crypto.decryptField("legacy-plaintext-key")).toBe("legacy-plaintext-key");
    expect(crypto.decryptField("")).toBe("");
  });

  it("fails to decrypt when the ciphertext is tampered (GCM auth tag verified)", () => {
    const crypto = createFieldCrypto(parseFieldKey(TEST_KEY_HEX));
    const enc = crypto.encryptField("integrity-matters");
    // Flip a character in the ciphertext segment.
    const [iv, tag, ct] = enc.slice(ENC_PREFIX.length).split(".");
    const flipped = ct[0] === "A" ? "B" : "A";
    const tampered = `${ENC_PREFIX}${iv}.${tag}.${flipped}${ct.slice(1)}`;
    expect(() => crypto.decryptField(tampered)).toThrow();
  });

  it("fails to decrypt ciphertext produced under a different key", () => {
    const a = createFieldCrypto(parseFieldKey(TEST_KEY_HEX));
    const b = createFieldCrypto(Buffer.alloc(32, 9)); // different key
    const enc = a.encryptField("cross-key");
    expect(() => b.decryptField(enc)).toThrow();
  });
});
