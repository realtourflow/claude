import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyDocusignSignature } from "@/lib/docusign-webhook";

const KEY = "super-secret-connect-key";
const BODY = JSON.stringify({
  data: { envelopeId: "e1", envelopeSummary: { status: "completed" } },
});

function sign(body: string, key: string): string {
  return createHmac("sha256", key).update(body, "utf8").digest("base64");
}
function headers(map: Record<string, string>): Headers {
  return new Headers(map);
}

describe("verifyDocusignSignature", () => {
  it("accepts a body signed with the configured key", () => {
    const h = headers({ "x-docusign-signature-1": sign(BODY, KEY) });
    expect(verifyDocusignSignature(BODY, h, KEY)).toBe(true);
  });

  it("rejects a signature made with a different key", () => {
    const h = headers({ "x-docusign-signature-1": sign(BODY, "other-key") });
    expect(verifyDocusignSignature(BODY, h, KEY)).toBe(false);
  });

  it("rejects when the body was tampered with after signing", () => {
    const h = headers({ "x-docusign-signature-1": sign(BODY, KEY) });
    // Same signature, different body → digest no longer matches.
    expect(verifyDocusignSignature(BODY + " ", h, KEY)).toBe(false);
  });

  it("rejects when no signature header is present", () => {
    expect(verifyDocusignSignature(BODY, headers({}), KEY)).toBe(false);
  });

  it("accepts when any of several signature headers matches (key rotation)", () => {
    const h = headers({
      "x-docusign-signature-1": sign(BODY, "retired-key"),
      "x-docusign-signature-2": sign(BODY, KEY),
    });
    expect(verifyDocusignSignature(BODY, h, KEY)).toBe(true);
  });

  it("rejects a malformed signature without throwing", () => {
    const h = headers({ "x-docusign-signature-1": "!!!not-base64!!!" });
    expect(verifyDocusignSignature(BODY, h, KEY)).toBe(false);
  });

  it("rejects when no key is configured", () => {
    const h = headers({ "x-docusign-signature-1": sign(BODY, "") });
    expect(verifyDocusignSignature(BODY, h, "")).toBe(false);
  });
});
