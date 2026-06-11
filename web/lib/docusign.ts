/**
 * DocuSign e-signature client. Mirrors the legacy Go backend.
 *
 * Sends documents for signature and reads envelope status via the DocuSign
 * eSignature REST API. Auth is the JWT bearer grant ("impersonation"): we mint
 * an RS256 JWT signed with the integration's private key, POST it to
 * /oauth/token, and cache the returned bearer until just before it expires.
 *
 * Test seams:
 * - setDocusignForTesting() injects a whole fake client (route-level tests).
 * - DefaultDocusignClient also takes an injectable `fetch` so its real
 *   token/envelope flow can be unit-tested directly (see lib/docusign.test.ts)
 *   without hitting real DocuSign.
 */
import { createPrivateKey, type KeyObject } from "node:crypto";
import { SignJWT } from "jose";
import { env } from "./env";

export type DocusignSigner = { email: string; name: string };

export type DocusignClient = {
  enabled(): boolean;
  createEnvelope(
    docName: string,
    docBytes: Uint8Array,
    signers: DocusignSigner[]
  ): Promise<string>;
  getEnvelopeStatus(envelopeId: string): Promise<string>;
};

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

let stub: DocusignClient | undefined;

export function setDocusignForTesting(c: DocusignClient | undefined): void {
  stub = c;
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

export class DefaultDocusignClient implements DocusignClient {
  private accessToken = "";
  private tokenExpiresAt = 0; // epoch ms
  private privateKey: KeyObject | undefined;

  constructor(private readonly fetchImpl: FetchLike = defaultFetch) {}

  enabled(): boolean {
    const e = env();
    return (
      !!e.DOCUSIGN_INTEGRATION_KEY &&
      !!e.DOCUSIGN_PRIVATE_KEY &&
      !!e.DOCUSIGN_ACCOUNT_ID &&
      !!e.DOCUSIGN_USER_ID
    );
  }

  // base REST URL, trailing slash trimmed (e.g. https://demo.docusign.net).
  private baseURL(): string {
    return env().DOCUSIGN_BASE_URL.replace(/\/+$/, "");
  }

  // The OAuth host depends on the environment: demo vs production.
  private authURL(): string {
    return this.baseURL().includes("demo")
      ? "https://account-d.docusign.com"
      : "https://account.docusign.com";
  }

  private loadPrivateKey(): KeyObject {
    if (!this.privateKey) {
      // Env vars may encode newlines as literal "\n" — normalize first.
      const pem = env().DOCUSIGN_PRIVATE_KEY.replace(/\\n/g, "\n");
      // Node handles PKCS1 ("BEGIN RSA PRIVATE KEY") and PKCS8 alike.
      this.privateKey = createPrivateKey(pem);
    }
    return this.privateKey;
  }

  // Returns a cached bearer token, minting a fresh one when missing/expired.
  private async token(): Promise<string> {
    if (this.accessToken && this.tokenExpiresAt > Date.now()) {
      return this.accessToken;
    }

    const authURL = this.authURL();
    // aud is the auth host without the scheme (e.g. account-d.docusign.com).
    const aud = authURL.replace(/^https?:\/\//, "");
    const e = env();
    const now = Math.floor(Date.now() / 1000);

    const assertion = await new SignJWT({ scope: "signature impersonation" })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(e.DOCUSIGN_INTEGRATION_KEY)
      .setSubject(e.DOCUSIGN_USER_ID)
      .setAudience(aud)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(this.loadPrivateKey());

    const res = await this.fetchImpl(`${authURL}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    });
    if (!res.ok) {
      throw new Error(
        `docusign token: status ${res.status}: ${await safeText(res)}`
      );
    }
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    const tok = data.access_token || "";
    if (!tok) {
      throw new Error("docusign token response contained no access_token field");
    }
    // Refresh a minute early; default to ~58 min when expires_in is absent.
    const ttlSec =
      data.expires_in && data.expires_in > 0 ? data.expires_in - 60 : 3500;
    this.accessToken = tok;
    this.tokenExpiresAt = Date.now() + ttlSec * 1000;
    return tok;
  }

  async createEnvelope(
    docName: string,
    docBytes: Uint8Array,
    signers: DocusignSigner[]
  ): Promise<string> {
    const token = await this.token();

    const dot = docName.lastIndexOf(".");
    const ext = dot >= 0 ? docName.slice(dot + 1).toLowerCase() : "pdf";

    const envelope = {
      emailSubject: "Please sign: " + docName,
      documents: [
        {
          documentBase64: Buffer.from(docBytes).toString("base64"),
          name: docName,
          fileExtension: ext,
          documentId: "1",
        },
      ],
      recipients: {
        signers: signers.map((s, i) => ({
          email: s.email,
          name: s.name,
          recipientId: String(i + 1),
          routingOrder: String(i + 1),
          tabs: {
            signHereTabs: [
              {
                documentId: "1",
                pageNumber: "1",
                xPosition: "100",
                yPosition: "680",
              },
            ],
          },
        })),
      },
      status: "sent",
    };

    const e = env();
    const url = `${this.baseURL()}/restapi/v2.1/accounts/${e.DOCUSIGN_ACCOUNT_ID}/envelopes`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(envelope),
    });
    if (res.status !== 201) {
      throw new Error(
        `docusign create envelope: status ${res.status}: ${await safeText(res)}`
      );
    }
    const result = (await res.json()) as { envelopeId?: string };
    return result.envelopeId ?? "";
  }

  async getEnvelopeStatus(envelopeId: string): Promise<string> {
    const token = await this.token();
    const e = env();
    const url = `${this.baseURL()}/restapi/v2.1/accounts/${e.DOCUSIGN_ACCOUNT_ID}/envelopes/${envelopeId}`;
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(
        `docusign get envelope status: status ${res.status}: ${await safeText(res)}`
      );
    }
    const result = (await res.json()) as { status?: string };
    return result.status ?? "";
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

let real: DocusignClient | undefined;

export function getDocusignClient(): DocusignClient {
  if (stub) return stub;
  if (!real) real = new DefaultDocusignClient();
  return real;
}
