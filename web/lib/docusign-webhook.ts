/**
 * DocuSign Connect webhook signature verification.
 *
 * When an HMAC key is configured in DocuSign Admin → Connect, DocuSign signs
 * every webhook POST with HMAC-SHA256 over the *raw* request body and sends the
 * base64 digest in an `X-DocuSign-Signature-1` header (one per configured key:
 * `-1`, `-2`, … for key rotation). We recompute the digest and timing-safe
 * compare it against each provided signature. Without this, anyone who learns an
 * envelopeId could POST a forged "completed" status to the public webhook.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Returns true iff one of the `X-DocuSign-Signature-N` headers matches
 * HMAC-SHA256(rawBody, key).
 *
 * `rawBody` MUST be the exact bytes DocuSign sent — read `req.text()` and verify
 * against that string BEFORE `JSON.parse`. Re-serializing the parsed object can
 * change the bytes (key order, whitespace) and break the digest.
 */
export function verifyDocusignSignature(
  rawBody: string,
  headers: Headers,
  key: string
): boolean {
  if (!key) return false;
  const expected = createHmac("sha256", key).update(rawBody, "utf8").digest();

  // Signatures are 1-indexed and contiguous; stop at the first gap. The cap is
  // just a defensive bound — DocuSign sends one header per configured key.
  for (let i = 1; i <= 16; i++) {
    const provided = headers.get(`x-docusign-signature-${i}`);
    if (!provided) break;
    const providedBuf = Buffer.from(provided, "base64");
    if (
      providedBuf.length === expected.length &&
      timingSafeEqual(providedBuf, expected)
    ) {
      return true;
    }
  }
  return false;
}
