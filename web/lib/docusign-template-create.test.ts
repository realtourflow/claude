import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { DefaultDocusignClient, type FetchLike } from "@/lib/docusign";
import { resetEnvForTesting } from "@/lib/env";

const ENV_KEYS = [
  "DOCUSIGN_INTEGRATION_KEY",
  "DOCUSIGN_USER_ID",
  "DOCUSIGN_ACCOUNT_ID",
  "DOCUSIGN_PRIVATE_KEY",
  "DOCUSIGN_BASE_URL",
] as const;
const saved: Record<string, string | undefined> = {};
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

beforeAll(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.DOCUSIGN_INTEGRATION_KEY = "ik";
  process.env.DOCUSIGN_USER_ID = "uid";
  process.env.DOCUSIGN_ACCOUNT_ID = "acct";
  process.env.DOCUSIGN_PRIVATE_KEY = PEM;
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

describe("DefaultDocusignClient.createTemplateFromDocument", () => {
  it("POSTs the document + per-role tabs and returns the templateId", async () => {
    const calls: { url: string; body: string }[] = [];
    const fakeFetch: FetchLike = async (url, init) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      }
      if (url.includes("/templates")) {
        calls.push({ url, body: String(init?.body ?? "") });
        return jsonResponse({ templateId: "tmpl-1" }, 201);
      }
      throw new Error(`unexpected url ${url}`);
    };

    const client = new DefaultDocusignClient(fakeFetch);
    const id = await client.createTemplateFromDocument({
      name: "My Form",
      documentName: "form.pdf",
      documentBytes: new Uint8Array([1, 2, 3]),
      signers: [
        {
          roleName: "Buyer",
          recipientId: "1",
          textTabs: [
            { tabLabel: "buyer_name", pageNumber: 1, x: 72, y: 74, width: 200, height: 18 },
          ],
          signHereTabs: [{ tabLabel: "buyer_sig", pageNumber: 1, x: 72, y: 672 }],
        },
      ],
    });

    expect(id).toBe("tmpl-1");
    const call = calls.find((c) => c.url.includes("/templates"))!;
    expect(call.url).toContain("/restapi/v2.1/accounts/acct/templates");
    const payload = JSON.parse(call.body) as {
      documents: { documentBase64: string; fileExtension: string }[];
      recipients: { signers: Array<Record<string, unknown>> };
    };
    expect(payload.documents[0].documentBase64).toBeTruthy();
    expect(payload.documents[0].fileExtension).toBe("pdf");
    const signer = payload.recipients.signers[0] as {
      roleName: string;
      tabs: {
        textTabs: Record<string, string>[];
        signHereTabs: Record<string, string>[];
      };
    };
    expect(signer.roleName).toBe("Buyer");
    expect(signer.tabs.textTabs[0]).toMatchObject({
      tabLabel: "buyer_name",
      xPosition: "72",
      yPosition: "74",
      width: "200",
    });
    // Signature tabs are point-anchored — no width/height emitted.
    expect(signer.tabs.signHereTabs[0]).toMatchObject({
      tabLabel: "buyer_sig",
      xPosition: "72",
      yPosition: "672",
    });
    expect(signer.tabs.signHereTabs[0].width).toBeUndefined();
  });
});
