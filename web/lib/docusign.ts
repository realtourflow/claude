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

export type DocusignSigner = {
  email: string;
  name: string;
  // RTF user identity for recipient-row linkage. NEVER serialized to DocuSign —
  // payload construction picks fields explicitly.
  userId?: string;
  // Set only for embedded signing (Stage 2+): DocuSign skips its email and the
  // recipient signs in-app. Stage 1 ships email links for everyone, so routing
  // leaves this unset; outside signers never get one.
  clientUserId?: string;
  routingOrder?: number;
  recipientId?: string;
};

// Prefill payload for one template role: values poured into the template's
// existing tabs by label (placement still lives on the template).
export type TemplateRoleTabs = {
  textTabs?: { tabLabel: string; value: string }[];
  checkboxTabs?: { tabLabel: string; selected: string }[];
};

// A role on a DocuSign template. Field PLACEMENT lives on the template —
// tagged once in the DocuSign account; `tabs` only PREFILLS those tabs with
// values (contract-fill), it never positions anything.
export type TemplateRole = {
  roleName: string;
  name: string;
  email: string;
  // RTF user identity — internal only, never serialized (see DocusignSigner).
  userId?: string;
  clientUserId?: string;
  routingOrder?: number;
  tabs?: TemplateRoleTabs;
};

export type EnvelopeRecipientStatus = {
  email: string;
  name: string;
  status: string;
  recipientId: string;
};

export type DocusignClient = {
  enabled(): boolean;
  createEnvelope(
    docName: string,
    docBytes: Uint8Array,
    signers: DocusignSigner[]
  ): Promise<string>;
  createTemplateEnvelope(
    templateId: string,
    roles: TemplateRole[]
  ): Promise<string>;
  getEnvelopeStatus(envelopeId: string): Promise<string>;
  // The combined (all documents + signatures) PDF of a completed envelope.
  downloadCombinedDocument(envelopeId: string): Promise<Uint8Array>;
  // Authoritative per-recipient statuses straight from DocuSign (self-heal).
  listRecipients(envelopeId: string): Promise<EnvelopeRecipientStatus[]>;
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
  private privateKeyParseFailed = false;

  constructor(private readonly fetchImpl: FetchLike = defaultFetch) {}

  enabled(): boolean {
    const e = env();
    return (
      !!e.DOCUSIGN_INTEGRATION_KEY &&
      !!e.DOCUSIGN_PRIVATE_KEY &&
      !!e.DOCUSIGN_ACCOUNT_ID &&
      !!e.DOCUSIGN_USER_ID &&
      // A malformed key must surface as a clean enabled()=false (→ 503), not a
      // mid-request throw (→ 502). Go only set `enabled` after the key parsed.
      this.parsePrivateKey() !== undefined
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

  // Parses the configured PKCS1/PKCS8 key, caching both success and failure so
  // a bad key is decided once. Returns undefined when the key is missing or
  // unparseable — callers turn that into enabled()=false / a thrown load.
  private parsePrivateKey(): KeyObject | undefined {
    if (this.privateKey) return this.privateKey;
    if (this.privateKeyParseFailed) return undefined;
    const raw = env().DOCUSIGN_PRIVATE_KEY;
    if (!raw) {
      this.privateKeyParseFailed = true;
      return undefined;
    }
    try {
      // Env vars may encode newlines as literal "\n" — normalize first.
      // Node handles PKCS1 ("BEGIN RSA PRIVATE KEY") and PKCS8 alike.
      this.privateKey = createPrivateKey(raw.replace(/\\n/g, "\n"));
      return this.privateKey;
    } catch {
      this.privateKeyParseFailed = true;
      return undefined;
    }
  }

  private loadPrivateKey(): KeyObject {
    const key = this.parsePrivateKey();
    if (!key) {
      throw new Error("docusign: DOCUSIGN_PRIVATE_KEY is missing or unparseable");
    }
    return key;
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
      ...this.eventNotification(),
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
          recipientId: s.recipientId ?? String(i + 1),
          routingOrder: String(s.routingOrder ?? i + 1),
          ...(s.clientUserId ? { clientUserId: s.clientUserId } : {}),
          tabs: {
            // Fallback path only (one-off uploads): stack each signer's
            // signature + date line at a distinct spot so signers never land
            // on the same point. Template sends never reach this code — their
            // placement lives on the template.
            signHereTabs: [
              {
                documentId: "1",
                pageNumber: "1",
                xPosition: "100",
                yPosition: String(680 - 60 * i),
              },
            ],
            dateSignedTabs: [
              {
                documentId: "1",
                pageNumber: "1",
                xPosition: "300",
                yPosition: String(680 - 60 * i),
              },
            ],
          },
        })),
      },
      status: "sent",
    };

    return this.postEnvelope(token, envelope);
  }

  // Code-controlled webhook subscription, attached per envelope so it works
  // identically on demo and prod (Go-Live needs no admin-UI Connect setup).
  // requireAcknowledgment makes DocuSign retry non-2xx deliveries.
  private eventNotification(): object | undefined {
    const url = env().DOCUSIGN_WEBHOOK_URL;
    if (!url) return undefined;
    return {
      eventNotification: {
        url,
        requireAcknowledgment: "true",
        deliveryMode: "SIM",
        events: [
          "envelope-completed",
          "envelope-declined",
          "envelope-voided",
          "recipient-completed",
          "recipient-delivered",
        ],
        eventData: {
          version: "restv2.1",
          format: "json",
          includeData: ["recipients"],
        },
      },
    };
  }

  // Template-based send: field placement/tabs are tagged once on the DocuSign
  // template, so the payload carries only the template id + role assignments.
  async createTemplateEnvelope(
    templateId: string,
    roles: TemplateRole[]
  ): Promise<string> {
    const token = await this.token();
    const envelope = {
      ...this.eventNotification(),
      templateId,
      templateRoles: roles.map((r) => ({
        roleName: r.roleName,
        name: r.name,
        email: r.email,
        ...(r.clientUserId ? { clientUserId: r.clientUserId } : {}),
        ...(r.routingOrder !== undefined
          ? { routingOrder: String(r.routingOrder) }
          : {}),
        ...(r.tabs && (r.tabs.textTabs?.length || r.tabs.checkboxTabs?.length)
          ? { tabs: r.tabs }
          : {}),
      })),
      status: "sent",
    };
    return this.postEnvelope(token, envelope);
  }

  private async postEnvelope(token: string, envelope: object): Promise<string> {
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
    if (!result.envelopeId) {
      // A 201 with no envelopeId would persist "" and make refresh impossible
      // to ever poll — fail loudly instead.
      throw new Error("docusign create envelope: 201 response missing envelopeId");
    }
    return result.envelopeId;
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

  async downloadCombinedDocument(envelopeId: string): Promise<Uint8Array> {
    const token = await this.token();
    const e = env();
    const url = `${this.baseURL()}/restapi/v2.1/accounts/${e.DOCUSIGN_ACCOUNT_ID}/envelopes/${envelopeId}/documents/combined`;
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(
        `docusign download combined: status ${res.status}: ${await safeText(res)}`
      );
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  async listRecipients(envelopeId: string): Promise<EnvelopeRecipientStatus[]> {
    const token = await this.token();
    const e = env();
    const url = `${this.baseURL()}/restapi/v2.1/accounts/${e.DOCUSIGN_ACCOUNT_ID}/envelopes/${envelopeId}/recipients`;
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(
        `docusign list recipients: status ${res.status}: ${await safeText(res)}`
      );
    }
    const result = (await res.json()) as {
      signers?: { email?: string; name?: string; status?: string; recipientId?: string }[];
    };
    return (result.signers ?? []).map((s) => ({
      email: s.email ?? "",
      name: s.name ?? "",
      status: s.status ?? "",
      recipientId: s.recipientId ?? "",
    }));
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
