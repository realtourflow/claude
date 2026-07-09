import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { verifyDocusignSignature } from "@/lib/docusign-webhook";
import { POST as webhookRoute } from "@/app/api/docusign/webhook/route";
import { resetEnvForTesting } from "@/lib/env";
import { prisma } from "@/lib/db";
import { truncateAll } from "@/tests/helpers/db";
import { createUser, createDeal } from "@/tests/helpers/factories";

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

/**
 * Fail-closed enforcement on the route itself (#176).
 *
 * The public webhook must never trust an unsigned POST when it is actually
 * live: in Vercel production (VERCEL_ENV=production) or wherever
 * DOCUSIGN_WEBHOOK_URL is configured, a missing DOCUSIGN_CONNECT_HMAC_KEY
 * means every request is rejected with 401 — not silently accepted the way
 * the legacy/demo (local dev) path allows.
 */
describe("POST /api/docusign/webhook — fail-closed signature enforcement", () => {
  const HMAC_KEY = "test-fail-closed-hmac-key";
  // Prod also requires OAUTH_STATE_SECRET (32+ chars) — set it so these tests
  // exercise the missing-HMAC-key behavior, not the unrelated OAuth guard.
  const STRONG_OAUTH_SECRET = "0123456789abcdef0123456789abcdef";

  const ENV_KEYS = [
    "VERCEL_ENV",
    "DOCUSIGN_CONNECT_HMAC_KEY",
    "DOCUSIGN_WEBHOOK_URL",
    "OAUTH_STATE_SECRET",
  ] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(async () => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    resetEnvForTesting();
    await truncateAll();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetEnvForTesting();
  });

  async function seedDoc(envelopeId: string) {
    const agent = await createUser({ role: "agent" });
    const deal = await createDeal({ agent_id: agent.id });
    return prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "x.pdf",
        s3_key: "k",
        docusign_envelope_id: envelopeId,
        docusign_status: "sent",
      },
    });
  }

  function forgedBody(envelopeId: string): string {
    return JSON.stringify({
      data: { envelopeId, envelopeSummary: { status: "declined" } },
    });
  }

  function post(body: string, extraHeaders: Record<string, string> = {}) {
    return new Request("http://localhost/api/docusign/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", ...extraHeaders },
      body,
    });
  }

  it("production-mode env with no HMAC key rejects an unsigned webhook with 401 (no mutation)", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.OAUTH_STATE_SECRET = STRONG_OAUTH_SECRET;
    resetEnvForTesting();

    const doc = await seedDoc("env-prod-nokey");
    const res = await webhookRoute(post(forgedBody("env-prod-nokey")));
    expect(res.status).toBe(401);

    const row = await prisma.documents.findUnique({ where: { id: doc.id } });
    expect(row?.docusign_status).toBe("sent"); // forged status never applied
  });

  it("webhook-live env (DOCUSIGN_WEBHOOK_URL set) with no key rejects an unsigned webhook with 401", async () => {
    process.env.DOCUSIGN_WEBHOOK_URL =
      "https://app.example.com/api/docusign/webhook";
    resetEnvForTesting();

    const doc = await seedDoc("env-live-nokey");
    const res = await webhookRoute(post(forgedBody("env-live-nokey")));
    expect(res.status).toBe(401);

    const row = await prisma.documents.findUnique({ where: { id: doc.id } });
    expect(row?.docusign_status).toBe("sent");
  });

  it("accepts a validly-signed payload when a key is set", async () => {
    process.env.DOCUSIGN_CONNECT_HMAC_KEY = HMAC_KEY;
    resetEnvForTesting();

    const doc = await seedDoc("env-signed-ok");
    const body = JSON.stringify({
      data: {
        envelopeId: "env-signed-ok",
        envelopeSummary: { status: "delivered" },
      },
    });
    const res = await webhookRoute(
      post(body, { "x-docusign-signature-1": sign(body, HMAC_KEY) })
    );
    expect(res.status).toBe(200);

    const row = await prisma.documents.findUnique({ where: { id: doc.id } });
    expect(row?.docusign_status).toBe("delivered"); // signed status applied
  });

  it("rejects a badly-signed payload with 401 when a key is set", async () => {
    process.env.DOCUSIGN_CONNECT_HMAC_KEY = HMAC_KEY;
    resetEnvForTesting();

    const doc = await seedDoc("env-badsig");
    const body = forgedBody("env-badsig");
    const res = await webhookRoute(
      post(body, { "x-docusign-signature-1": sign(body, "wrong-key") })
    );
    expect(res.status).toBe(401);

    const row = await prisma.documents.findUnique({ where: { id: doc.id } });
    expect(row?.docusign_status).toBe("sent");
  });

  it("still trusts an unsigned POST in local dev (no key, webhook not live, not prod)", async () => {
    // Legacy/demo path preserved: nothing indicates the webhook is real, so
    // dev and CI keep working with zero config.
    const doc = await seedDoc("env-dev-open");
    const body = JSON.stringify({
      data: {
        envelopeId: "env-dev-open",
        envelopeSummary: { status: "delivered" },
      },
    });
    const res = await webhookRoute(post(body));
    expect(res.status).toBe(200);

    const row = await prisma.documents.findUnique({ where: { id: doc.id } });
    expect(row?.docusign_status).toBe("delivered");
  });
});
