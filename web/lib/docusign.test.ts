import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { DefaultDocusignClient, type FetchLike } from "@/lib/docusign";
import { resetEnvForTesting } from "@/lib/env";

// Exercise the REAL DefaultDocusignClient with an injected fetch, so the JWT
// bearer-grant token flow + envelope create/status mapping are covered directly.
// The route tests in tests/api/docusign.test.ts inject a whole fake client and
// never touch this layer.

const ENV_KEYS = [
  "DOCUSIGN_INTEGRATION_KEY",
  "DOCUSIGN_USER_ID",
  "DOCUSIGN_ACCOUNT_ID",
  "DOCUSIGN_PRIVATE_KEY",
  "DOCUSIGN_BASE_URL",
] as const;
const saved: Record<string, string | undefined> = {};

// A real RSA private key (PKCS1 PEM) so the client can actually sign the JWT.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY_PEM = privateKey
  .export({ type: "pkcs1", format: "pem" })
  .toString();

beforeAll(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.DOCUSIGN_INTEGRATION_KEY = "test-integration-key";
  process.env.DOCUSIGN_USER_ID = "test-user-id";
  process.env.DOCUSIGN_ACCOUNT_ID = "test-account-id";
  process.env.DOCUSIGN_PRIVATE_KEY = PRIVATE_KEY_PEM;
  // "demo" routes to account-d.docusign.com for the OAuth host.
  process.env.DOCUSIGN_BASE_URL = "https://demo.docusign.net";
  resetEnvForTesting();
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetEnvForTesting();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Call = { url: string; init?: RequestInit };

describe("DefaultDocusignClient.createEnvelope", () => {
  it("mints a JWT bearer token then POSTs the envelope", async () => {
    const calls: Call[] = [];
    const fakeFetch: FetchLike = async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      }
      if (url.includes("/envelopes")) {
        return jsonResponse({ envelopeId: "env-123" }, 201);
      }
      throw new Error(`unexpected url ${url}`);
    };

    const client = new DefaultDocusignClient(fakeFetch);
    const envelopeId = await client.createEnvelope(
      "contract.pdf",
      new Uint8Array([1, 2, 3]),
      [{ email: "buyer@example.com", name: "Buyer One" }]
    );

    expect(envelopeId).toBe("env-123");

    // Token endpoint: demo base → account-d host, urlencoded grant + assertion.
    const tokenCall = calls.find((c) => c.url.endsWith("/oauth/token"));
    expect(tokenCall?.url).toBe("https://account-d.docusign.com/oauth/token");
    const tokenHeaders = tokenCall?.init?.headers as Record<string, string>;
    expect(tokenHeaders["content-type"]).toBe(
      "application/x-www-form-urlencoded"
    );
    const form = new URLSearchParams(tokenCall?.init?.body as string);
    expect(form.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer"
    );
    expect(form.get("assertion")).toBeTruthy();
    // A JWT has three dot-separated segments.
    const assertion = form.get("assertion") as string;
    expect(assertion.split(".")).toHaveLength(3);
    // Decode and assert the grant claims — a swapped iss/sub, dropped scope, or
    // wrong signing alg would otherwise sail through the "3 segments" check.
    expect(decodeProtectedHeader(assertion).alg).toBe("RS256");
    const claims = decodeJwt(assertion);
    expect(claims.iss).toBe("test-integration-key"); // integration (client) key
    expect(claims.sub).toBe("test-user-id"); // impersonated user
    expect(claims.aud).toBe("account-d.docusign.com"); // demo auth host, no scheme
    expect(claims.scope).toBe("signature impersonation");

    // Envelope endpoint: right URL, Bearer token, signer + document payload.
    const envCall = calls.find((c) => c.url.includes("/envelopes"));
    expect(envCall?.url).toBe(
      "https://demo.docusign.net/restapi/v2.1/accounts/test-account-id/envelopes"
    );
    const envHeaders = envCall?.init?.headers as Record<string, string>;
    expect(envHeaders.authorization).toBe("Bearer tok");
    const sent = JSON.parse(envCall?.init?.body as string);
    expect(sent.emailSubject).toBe("Please sign: contract.pdf");
    expect(sent.status).toBe("sent");
    expect(sent.documents[0].fileExtension).toBe("pdf");
    expect(sent.documents[0].documentBase64).toBe(
      Buffer.from([1, 2, 3]).toString("base64")
    );
    expect(sent.recipients.signers[0]).toMatchObject({
      email: "buyer@example.com",
      name: "Buyer One",
      recipientId: "1",
      routingOrder: "1",
    });
  });

  it("throws on a non-201 envelope response", async () => {
    const fakeFetch: FetchLike = async (url) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      }
      return new Response("bad request", { status: 400 });
    };
    const client = new DefaultDocusignClient(fakeFetch);
    await expect(
      client.createEnvelope("x.pdf", new Uint8Array([1]), [
        { email: "a@b.com", name: "A" },
      ])
    ).rejects.toThrow(/400/);
  });

  it("throws when a 201 response carries no envelopeId", async () => {
    const fakeFetch: FetchLike = async (url) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      }
      // 201 Created but the body has no envelopeId — must not persist "".
      return jsonResponse({}, 201);
    };
    const client = new DefaultDocusignClient(fakeFetch);
    await expect(
      client.createEnvelope("x.pdf", new Uint8Array([1]), [
        { email: "a@b.com", name: "A" },
      ])
    ).rejects.toThrow(/envelopeId/i);
  });
});

describe("DefaultDocusignClient.createEnvelope tab placement (fallback path)", () => {
  it("stacks each signer's signature + date tabs at distinct positions", async () => {
    let envBody: string | undefined;
    const fakeFetch: FetchLike = async (url, init) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      }
      envBody = init?.body as string;
      return jsonResponse({ envelopeId: "env-2" }, 201);
    };
    const client = new DefaultDocusignClient(fakeFetch);
    await client.createEnvelope("x.pdf", new Uint8Array([1]), [
      { email: "a@b.com", name: "A" },
      { email: "c@d.com", name: "C" },
    ]);
    const sent = JSON.parse(envBody as string);
    const [first, second] = sent.recipients.signers;
    // Every signer signs AND dates.
    expect(first.tabs.signHereTabs).toHaveLength(1);
    expect(first.tabs.dateSignedTabs).toHaveLength(1);
    expect(second.tabs.signHereTabs).toHaveLength(1);
    expect(second.tabs.dateSignedTabs).toHaveLength(1);
    // Signers must not stack on the same point.
    expect(first.tabs.signHereTabs[0].yPosition).not.toBe(
      second.tabs.signHereTabs[0].yPosition
    );
    // Date tab sits on the same line as its signature tab.
    expect(first.tabs.dateSignedTabs[0].yPosition).toBe(
      first.tabs.signHereTabs[0].yPosition
    );
  });

  it("passes clientUserId and explicit routing through on the fallback path", async () => {
    let envBody: string | undefined;
    const fakeFetch: FetchLike = async (url, init) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      }
      envBody = init?.body as string;
      return jsonResponse({ envelopeId: "env-3" }, 201);
    };
    const client = new DefaultDocusignClient(fakeFetch);
    await client.createEnvelope("x.pdf", new Uint8Array([1]), [
      { email: "a@b.com", name: "A", clientUserId: "user-uuid-1", routingOrder: 2 },
      { email: "c@d.com", name: "C" },
    ]);
    const sent = JSON.parse(envBody as string);
    expect(sent.recipients.signers[0].clientUserId).toBe("user-uuid-1");
    expect(sent.recipients.signers[0].routingOrder).toBe("2");
    // No clientUserId given -> the key is absent (DocuSign emails this signer).
    expect("clientUserId" in sent.recipients.signers[1]).toBe(false);
  });
});

describe("DefaultDocusignClient.createTemplateEnvelope", () => {
  it("POSTs templateId + templateRoles with status sent and NO documents/tabs", async () => {
    const calls: Call[] = [];
    const fakeFetch: FetchLike = async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      }
      if (url.includes("/envelopes")) {
        return jsonResponse({ envelopeId: "env-tpl-1" }, 201);
      }
      throw new Error(`unexpected url ${url}`);
    };
    const client = new DefaultDocusignClient(fakeFetch);
    const envelopeId = await client.createTemplateEnvelope("tpl-123", [
      {
        roleName: "Buyer",
        name: "Mike Smith",
        email: "mike@example.com",
        clientUserId: "user-uuid-buyer",
        userId: "internal-rtf-uuid", // identity link — must NOT serialize
      },
      { roleName: "Agent", name: "Sarah Johnson", email: "sarah@example.com" },
    ]);
    expect(envelopeId).toBe("env-tpl-1");

    const envCall = calls.find((c) => c.url.includes("/envelopes"));
    expect(envCall?.url).toBe(
      "https://demo.docusign.net/restapi/v2.1/accounts/test-account-id/envelopes"
    );
    const sent = JSON.parse(envCall?.init?.body as string);
    expect(sent.templateId).toBe("tpl-123");
    expect(sent.status).toBe("sent");
    // Placement comes from the template: no document upload, no coordinate tabs.
    expect(sent.documents).toBeUndefined();
    expect(JSON.stringify(sent)).not.toContain("signHereTabs");
    expect(JSON.stringify(sent)).not.toContain("xPosition");
    // Portal signer carries clientUserId (embedded); outside signer does not.
    expect(sent.templateRoles[0]).toMatchObject({
      roleName: "Buyer",
      name: "Mike Smith",
      email: "mike@example.com",
      clientUserId: "user-uuid-buyer",
    });
    expect("clientUserId" in sent.templateRoles[1]).toBe(false);
    // The internal RTF identity field never leaks to DocuSign.
    expect(JSON.stringify(sent)).not.toContain("internal-rtf-uuid");
    expect(JSON.stringify(sent)).not.toContain("userId");
  });

  it("serializes prefilled tabs on the right role and omits tabs when absent", async () => {
    let envBody: string | undefined;
    const fakeFetch: FetchLike = async (url, init) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      }
      envBody = init?.body as string;
      return jsonResponse({ envelopeId: "env-tpl-2" }, 201);
    };
    const client = new DefaultDocusignClient(fakeFetch);
    await client.createTemplateEnvelope("tpl-123", [
      {
        roleName: "Buyer",
        name: "Mike",
        email: "mike@example.com",
        tabs: {
          textTabs: [{ tabLabel: "PurchasePrice", value: "425000" }],
          checkboxTabs: [{ tabLabel: "HomeWarranty", selected: "true" }],
        },
      },
      { roleName: "Agent", name: "Sarah", email: "sarah@example.com" },
    ]);
    const sent = JSON.parse(envBody as string);
    expect(sent.templateRoles[0].tabs).toEqual({
      textTabs: [{ tabLabel: "PurchasePrice", value: "425000" }],
      checkboxTabs: [{ tabLabel: "HomeWarranty", selected: "true" }],
    });
    expect("tabs" in sent.templateRoles[1]).toBe(false);
  });

  it("throws on a 201 response missing envelopeId", async () => {
    const fakeFetch: FetchLike = async (url) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      }
      return jsonResponse({}, 201);
    };
    const client = new DefaultDocusignClient(fakeFetch);
    await expect(
      client.createTemplateEnvelope("tpl-123", [
        { roleName: "Buyer", name: "A", email: "a@b.com" },
      ])
    ).rejects.toThrow(/envelopeId/i);
  });

  it("throws on a non-201 response", async () => {
    const fakeFetch: FetchLike = async (url) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      }
      return new Response("bad", { status: 400 });
    };
    const client = new DefaultDocusignClient(fakeFetch);
    await expect(
      client.createTemplateEnvelope("tpl-123", [
        { roleName: "Buyer", name: "A", email: "a@b.com" },
      ])
    ).rejects.toThrow(/400/);
  });
});

describe("DefaultDocusignClient.getEnvelopeStatus", () => {
  it("returns the envelope status", async () => {
    const fakeFetch: FetchLike = async (url) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      }
      if (url.includes("/envelopes/")) {
        return jsonResponse({ status: "completed" });
      }
      throw new Error(`unexpected url ${url}`);
    };
    const client = new DefaultDocusignClient(fakeFetch);
    const status = await client.getEnvelopeStatus("env-123");
    expect(status).toBe("completed");
  });

  it("throws on a non-2xx status response", async () => {
    const fakeFetch: FetchLike = async (url) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      }
      return new Response("nope", { status: 404 });
    };
    const client = new DefaultDocusignClient(fakeFetch);
    await expect(client.getEnvelopeStatus("missing")).rejects.toThrow(/404/);
  });
});

describe("DefaultDocusignClient.downloadCombinedDocument", () => {
  it("GETs the combined signed PDF and returns its bytes", async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    let docUrl = "";
    const fakeFetch: FetchLike = async (url, init) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      }
      docUrl = url;
      expect((init?.headers as Record<string, string>).authorization).toBe(
        "Bearer tok"
      );
      return new Response(pdf, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    };
    const client = new DefaultDocusignClient(fakeFetch);
    const bytes = await client.downloadCombinedDocument("env-9");
    expect(docUrl).toBe(
      "https://demo.docusign.net/restapi/v2.1/accounts/test-account-id/envelopes/env-9/documents/combined"
    );
    expect(Array.from(bytes)).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it("throws on a non-2xx download", async () => {
    const fakeFetch: FetchLike = async (url) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      }
      return new Response("nope", { status: 404 });
    };
    const client = new DefaultDocusignClient(fakeFetch);
    await expect(client.downloadCombinedDocument("missing")).rejects.toThrow(/404/);
  });
});

describe("DefaultDocusignClient.listRecipients", () => {
  it("returns the envelope's signers with email/name/status/recipientId", async () => {
    const fakeFetch: FetchLike = async (url) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      }
      expect(url).toBe(
        "https://demo.docusign.net/restapi/v2.1/accounts/test-account-id/envelopes/env-9/recipients"
      );
      return jsonResponse({
        signers: [
          {
            email: "mike@example.com",
            name: "Mike Smith",
            status: "completed",
            recipientId: "1",
            extraNoise: "x",
          },
          { email: "sarah@example.com", name: "Sarah", status: "sent", recipientId: "2" },
        ],
      });
    };
    const client = new DefaultDocusignClient(fakeFetch);
    const recips = await client.listRecipients("env-9");
    expect(recips).toEqual([
      { email: "mike@example.com", name: "Mike Smith", status: "completed", recipientId: "1" },
      { email: "sarah@example.com", name: "Sarah", status: "sent", recipientId: "2" },
    ]);
  });

  it("throws on a non-2xx response", async () => {
    const fakeFetch: FetchLike = async (url) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      }
      return new Response("nope", { status: 500 });
    };
    const client = new DefaultDocusignClient(fakeFetch);
    await expect(client.listRecipients("env-9")).rejects.toThrow(/500/);
  });
});

describe("envelope-level eventNotification (code-controlled webhook)", () => {
  const KEY = "DOCUSIGN_WEBHOOK_URL";

  async function sentBodies(run: (c: DefaultDocusignClient) => Promise<unknown>) {
    const bodies: string[] = [];
    const fakeFetch: FetchLike = async (url, init) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      }
      bodies.push(init?.body as string);
      return jsonResponse({ envelopeId: "e" }, 201);
    };
    await run(new DefaultDocusignClient(fakeFetch));
    return bodies.map((b) => JSON.parse(b));
  }

  it("attaches eventNotification to BOTH send paths when the env is set", async () => {
    const prev = process.env[KEY];
    process.env[KEY] = "https://app.example.com/api/docusign/webhook";
    resetEnvForTesting();
    try {
      const [adhoc, tpl] = await sentBodies(async (c) => {
        await c.createEnvelope("x.pdf", new Uint8Array([1]), [
          { email: "a@b.com", name: "A" },
        ]);
        await c.createTemplateEnvelope("tpl-1", [
          { roleName: "Buyer", name: "A", email: "a@b.com" },
        ]);
      });
      for (const sent of [adhoc, tpl]) {
        expect(sent.eventNotification.url).toBe(
          "https://app.example.com/api/docusign/webhook"
        );
        expect(sent.eventNotification.requireAcknowledgment).toBe("true");
        expect(sent.eventNotification.events).toEqual([
          "envelope-completed",
          "envelope-declined",
          "envelope-voided",
          "recipient-completed",
          "recipient-delivered",
        ]);
        expect(sent.eventNotification.eventData).toEqual({
          version: "restv2.1",
          format: "json",
          includeData: ["recipients"],
        });
      }
    } finally {
      if (prev === undefined) delete process.env[KEY];
      else process.env[KEY] = prev;
      resetEnvForTesting();
    }
  });

  it("omits eventNotification when the env is unset", async () => {
    const [adhoc, tpl] = await sentBodies(async (c) => {
      await c.createEnvelope("x.pdf", new Uint8Array([1]), [
        { email: "a@b.com", name: "A" },
      ]);
      await c.createTemplateEnvelope("tpl-1", [
        { roleName: "Buyer", name: "A", email: "a@b.com" },
      ]);
    });
    expect("eventNotification" in adhoc).toBe(false);
    expect("eventNotification" in tpl).toBe(false);
  });
});

describe("DefaultDocusignClient token caching", () => {
  it("caches the bearer token across calls", async () => {
    let tokenCalls = 0;
    const fakeFetch: FetchLike = async (url) => {
      if (url.endsWith("/oauth/token")) {
        tokenCalls += 1;
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      }
      if (url.includes("/envelopes/")) return jsonResponse({ status: "sent" });
      if (url.includes("/envelopes"))
        return jsonResponse({ envelopeId: "e" }, 201);
      throw new Error(`unexpected url ${url}`);
    };
    const client = new DefaultDocusignClient(fakeFetch);
    await client.createEnvelope("a.pdf", new Uint8Array([1]), [
      { email: "a@b.com", name: "A" },
    ]);
    await client.getEnvelopeStatus("e");
    expect(tokenCalls).toBe(1);
  });
});

describe("DefaultDocusignClient.enabled", () => {
  it("is true when all required vars are set", () => {
    expect(new DefaultDocusignClient().enabled()).toBe(true);
  });

  it("is false when a required var is empty", () => {
    const prev = process.env.DOCUSIGN_USER_ID;
    process.env.DOCUSIGN_USER_ID = "";
    resetEnvForTesting();
    try {
      expect(new DefaultDocusignClient().enabled()).toBe(false);
    } finally {
      process.env.DOCUSIGN_USER_ID = prev;
      resetEnvForTesting();
    }
  });

  it("is false when the private key is set but unparseable", () => {
    const prev = process.env.DOCUSIGN_PRIVATE_KEY;
    // Non-empty (passes the presence check) but not a valid PEM — must read as
    // disabled (→ 503) rather than throwing mid-request (→ 502).
    process.env.DOCUSIGN_PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----\nnope\n-----END RSA PRIVATE KEY-----";
    resetEnvForTesting();
    try {
      expect(new DefaultDocusignClient().enabled()).toBe(false);
    } finally {
      process.env.DOCUSIGN_PRIVATE_KEY = prev;
      resetEnvForTesting();
    }
  });
});
