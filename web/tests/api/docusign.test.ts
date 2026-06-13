import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { createHmac } from "node:crypto";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { StreamingBlobPayloadOutputTypes } from "@smithy/types";
import { POST as sendForSignatureRoute } from "@/app/api/deals/[id]/documents/[documentId]/send-for-signature/route";
import { POST as refreshRoute } from "@/app/api/deals/[id]/documents/[documentId]/docusign/refresh/route";
import { POST as webhookRoute } from "@/app/api/docusign/webhook/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setS3ClientForTesting } from "@/lib/s3";
import {
  setDocusignForTesting,
  type DocusignClient,
  type DocusignSigner,
  type TemplateRole,
} from "@/lib/docusign";
import { prisma } from "@/lib/db";
import { resetEnvForTesting } from "@/lib/env";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser, createDeal } from "../helpers/factories";

const s3Mock = mockClient(S3Client);

// A small in-memory DocuSign fake. createEnvelope records its args + returns a
// fixed id; getEnvelopeStatus returns a settable status; enabled() is
// togglable so we can exercise the 503 path.
type FakeDocusign = DocusignClient & {
  enabledValue: boolean;
  statusValue: string;
  lastCreate?: { docName: string; bytes: Uint8Array; signers: DocusignSigner[] };
  lastTemplateCreate?: { templateId: string; roles: TemplateRole[] };
};

function makeFakeDocusign(): FakeDocusign {
  const fake: FakeDocusign = {
    enabledValue: true,
    statusValue: "completed",
    enabled() {
      return fake.enabledValue;
    },
    async createEnvelope(docName, bytes, signers) {
      fake.lastCreate = { docName, bytes, signers };
      return "env-fixed-123";
    },
    async createTemplateEnvelope(templateId, roles) {
      fake.lastTemplateCreate = { templateId, roles };
      return "env-tpl-123";
    },
    async getEnvelopeStatus() {
      return fake.statusValue;
    },
    async downloadCombinedDocument() {
      return new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    },
    async listRecipients() {
      return [];
    },
    async createRecipientView() {
      return "https://demo.docusign.net/signing/fake";
    },


  };
  return fake;
}

let fakeDocusign: FakeDocusign;

// A mock GetObject body exposing the v3 stream helper getObjectBytes() calls.
function bodyOf(bytes: Uint8Array): StreamingBlobPayloadOutputTypes {
  return {
    transformToByteArray: async () => bytes,
  } as unknown as StreamingBlobPayloadOutputTypes;
}

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);

  const client = new S3Client({
    region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  setS3ClientForTesting(client, "test-bucket");
});

beforeEach(async () => {
  await truncateAll();
  s3Mock.reset();
  s3Mock
    .on(GetObjectCommand)
    .resolves({ Body: bodyOf(new Uint8Array([1, 2, 3])) });
  fakeDocusign = makeFakeDocusign();
  setDocusignForTesting(fakeDocusign);
});

afterEach(() => {
  s3Mock.reset();
});

afterAll(() => {
  setDocusignForTesting(undefined);
  setS3ClientForTesting(undefined);
});

function ctx(id: string, documentId: string) {
  return { params: Promise.resolve({ id, documentId }) };
}

describe("POST /api/deals/[id]/documents/[documentId]/send-for-signature", () => {
  it("creates an envelope and persists id/status/sent_at", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const doc = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "contract.pdf",
        s3_key: "deals/x/1/contract.pdf",
      },
    });

    const req = new Request(
      `http://localhost/api/deals/${deal.id}/documents/${doc.id}/send-for-signature`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        body: JSON.stringify({
          signers: [{ email: "buyer@example.com", name: "Buyer One" }],
        }),
      }
    );
    const res = await sendForSignatureRoute(req, ctx(deal.id, doc.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { envelope_id: string; status: string };
    expect(body.envelope_id).toBe("env-fixed-123");
    expect(body.status).toBe("sent");

    // The fake received the document name, bytes (from S3), and signers.
    expect(fakeDocusign.lastCreate?.docName).toBe("contract.pdf");
    expect(Array.from(fakeDocusign.lastCreate?.bytes ?? [])).toEqual([1, 2, 3]);
    expect(fakeDocusign.lastCreate?.signers).toEqual([
      { email: "buyer@example.com", name: "Buyer One" },
    ]);

    const row = await prisma.documents.findUnique({ where: { id: doc.id } });
    expect(row?.docusign_envelope_id).toBe("env-fixed-123");
    expect(row?.docusign_status).toBe("sent");
    expect(row?.docusign_sent_at).not.toBeNull();
  });

  it("503 when DocuSign is not configured", async () => {
    fakeDocusign.enabledValue = false;
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const doc = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "contract.pdf",
        s3_key: "k",
      },
    });
    const req = new Request(
      `http://localhost/api/deals/${deal.id}/documents/${doc.id}/send-for-signature`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        body: JSON.stringify({
          signers: [{ email: "b@example.com", name: "B" }],
        }),
      }
    );
    const res = await sendForSignatureRoute(req, ctx(deal.id, doc.id));
    expect(res.status).toBe(503);
  });

  it("404 when caller is not the owning agent", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const stranger = await createUser({ role: "agent", auth0_id: "auth0|s" });
    void stranger;
    const deal = await createDeal({ agent_id: agent.id });
    const doc = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "contract.pdf",
        s3_key: "k",
      },
    });
    const req = new Request(
      `http://localhost/api/deals/${deal.id}/documents/${doc.id}/send-for-signature`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|s", ["agent"]),
        },
        body: JSON.stringify({
          signers: [{ email: "b@example.com", name: "B" }],
        }),
      }
    );
    const res = await sendForSignatureRoute(req, ctx(deal.id, doc.id));
    expect(res.status).toBe(404);
  });

  it("400 when no valid signers are provided", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const doc = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "contract.pdf",
        s3_key: "k",
      },
    });
    const req = new Request(
      `http://localhost/api/deals/${deal.id}/documents/${doc.id}/send-for-signature`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        body: JSON.stringify({ signers: [{ email: "", name: "" }] }),
      }
    );
    const res = await sendForSignatureRoute(req, ctx(deal.id, doc.id));
    expect(res.status).toBe(400);
  });

  it("502 when the DocuSign envelope send fails", async () => {
    fakeDocusign.createEnvelope = async () => {
      throw new Error("docusign upstream 500");
    };
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const doc = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "contract.pdf",
        s3_key: "deals/x/1/contract.pdf",
      },
    });
    const req = new Request(
      `http://localhost/api/deals/${deal.id}/documents/${doc.id}/send-for-signature`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        body: JSON.stringify({
          signers: [{ email: "b@example.com", name: "B" }],
        }),
      }
    );
    const res = await sendForSignatureRoute(req, ctx(deal.id, doc.id));
    expect(res.status).toBe(502);
  });
});

describe("POST /api/deals/[id]/documents/[documentId]/docusign/refresh", () => {
  it("fetches the latest status and persists it", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const doc = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "x.pdf",
        s3_key: "k",
        docusign_envelope_id: "env-1",
        docusign_status: "sent",
      },
    });
    // Use a value distinct from both the "sent" fixture and the fake's default
    // so the test proves the fetched status round-trips (not a hardcode).
    fakeDocusign.statusValue = "declined";

    const req = new Request(
      `http://localhost/api/deals/${deal.id}/documents/${doc.id}/docusign/refresh`,
      {
        method: "POST",
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }
    );
    const res = await refreshRoute(req, ctx(deal.id, doc.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("declined");

    const row = await prisma.documents.findUnique({ where: { id: doc.id } });
    expect(row?.docusign_status).toBe("declined");
  });

  it("502 when the DocuSign status fetch fails", async () => {
    fakeDocusign.getEnvelopeStatus = async () => {
      throw new Error("docusign upstream 500");
    };
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const doc = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "x.pdf",
        s3_key: "k",
        docusign_envelope_id: "env-1",
        docusign_status: "sent",
      },
    });
    const req = new Request(
      `http://localhost/api/deals/${deal.id}/documents/${doc.id}/docusign/refresh`,
      {
        method: "POST",
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }
    );
    const res = await refreshRoute(req, ctx(deal.id, doc.id));
    expect(res.status).toBe(502);
    // The stale status must remain untouched when the upstream call fails.
    const row = await prisma.documents.findUnique({ where: { id: doc.id } });
    expect(row?.docusign_status).toBe("sent");
  });

  it("503 when DocuSign is not configured", async () => {
    fakeDocusign.enabledValue = false;
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const doc = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "x.pdf",
        s3_key: "k",
        docusign_envelope_id: "env-1",
      },
    });
    const req = new Request(
      `http://localhost/api/deals/${deal.id}/documents/${doc.id}/docusign/refresh`,
      {
        method: "POST",
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }
    );
    const res = await refreshRoute(req, ctx(deal.id, doc.id));
    expect(res.status).toBe(503);
  });

  it("a participant (not just the agent) may refresh", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const buyer = await createUser({ role: "buyer", auth0_id: "auth0|b" });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });
    const doc = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "x.pdf",
        s3_key: "k",
        docusign_envelope_id: "env-1",
      },
    });
    const req = new Request(
      `http://localhost/api/deals/${deal.id}/documents/${doc.id}/docusign/refresh`,
      {
        method: "POST",
        headers: { authorization: await authHeader("auth0|b", ["buyer"]) },
      }
    );
    const res = await refreshRoute(req, ctx(deal.id, doc.id));
    expect(res.status).toBe(200);
  });

  it("403 when the caller has no access to the deal", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const stranger = await createUser({ role: "buyer", auth0_id: "auth0|s" });
    void stranger;
    const deal = await createDeal({ agent_id: agent.id });
    const doc = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "x.pdf",
        s3_key: "k",
        docusign_envelope_id: "env-1",
      },
    });
    const req = new Request(
      `http://localhost/api/deals/${deal.id}/documents/${doc.id}/docusign/refresh`,
      {
        method: "POST",
        headers: { authorization: await authHeader("auth0|s", ["buyer"]) },
      }
    );
    const res = await refreshRoute(req, ctx(deal.id, doc.id));
    expect(res.status).toBe(403);
  });

  it("self-heals on refresh: syncs recipients and archives a completed envelope", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const doc = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "Buyer Agency Agreement",
        s3_key: "",
        purpose: "baa",
        docusign_envelope_id: "env-heal",
        docusign_status: "sent",
      },
    });
    await prisma.docusign_recipients.create({
      data: {
        document_id: doc.id,
        envelope_id: "env-heal",
        user_id: agent.id,
        email: "sarah@example.com",
        name: "Sarah Johnson",
        role: "Agent",
        recipient_id: "1",
        routing_order: 1,
        status: "sent",
      },
    });
    fakeDocusign.statusValue = "completed";
    fakeDocusign.listRecipients = async () => [
      { email: "SARAH@example.com", name: "Sarah Johnson", status: "completed", recipientId: "z1" },
    ];

    const req = new Request(
      `http://localhost/api/deals/${deal.id}/documents/${doc.id}/docusign/refresh`,
      {
        method: "POST",
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }
    );
    const res = await refreshRoute(req, ctx(deal.id, doc.id));
    expect(res.status).toBe(200);

    // Recipients synced (case-insensitive email match), PDF archived, BAA flipped.
    const recip = await prisma.docusign_recipients.findFirst({
      where: { document_id: doc.id },
    });
    expect(recip?.status).toBe("completed");
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);
    const row = await prisma.documents.findUnique({ where: { id: doc.id } });
    expect(row?.docusign_signed_s3_key).toBeTruthy();
    const dealRow = await prisma.deals.findUnique({ where: { id: deal.id } });
    expect(dealRow?.baa_signed).toBe(true);
  });

  it("refresh on a still-pending envelope syncs recipients without archiving", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const doc = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "x.pdf",
        s3_key: "k",
        docusign_envelope_id: "env-pending",
        docusign_status: "sent",
      },
    });
    await prisma.docusign_recipients.create({
      data: {
        document_id: doc.id,
        envelope_id: "env-pending",
        email: "mike@example.com",
        name: "Mike",
        role: "Buyer",
        recipient_id: "1",
        routing_order: 1,
        status: "sent",
      },
    });
    fakeDocusign.statusValue = "delivered";
    fakeDocusign.listRecipients = async () => [
      { email: "mike@example.com", name: "Mike", status: "delivered", recipientId: "z2" },
    ];

    const req = new Request(
      `http://localhost/api/deals/${deal.id}/documents/${doc.id}/docusign/refresh`,
      {
        method: "POST",
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }
    );
    const res = await refreshRoute(req, ctx(deal.id, doc.id));
    expect(res.status).toBe(200);
    const recip = await prisma.docusign_recipients.findFirst({
      where: { document_id: doc.id },
    });
    expect(recip?.status).toBe("delivered");
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it("404 when the document has no envelope", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const doc = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "x.pdf",
        s3_key: "k",
      },
    });
    const req = new Request(
      `http://localhost/api/deals/${deal.id}/documents/${doc.id}/docusign/refresh`,
      {
        method: "POST",
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }
    );
    const res = await refreshRoute(req, ctx(deal.id, doc.id));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/docusign/webhook", () => {
  it("updates docusign_status by envelope id and returns 200 (no auth)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const doc = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "x.pdf",
        s3_key: "k",
        docusign_envelope_id: "env-hook",
        docusign_status: "sent",
      },
    });

    const req = new Request("http://localhost/api/docusign/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "envelope-completed",
        data: {
          envelopeId: "env-hook",
          envelopeSummary: { status: "completed" },
        },
      }),
    });
    const res = await webhookRoute(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const row = await prisma.documents.findUnique({ where: { id: doc.id } });
    expect(row?.docusign_status).toBe("completed");
  });

  it("returns 200 even on an unparseable body", async () => {
    const req = new Request("http://localhost/api/docusign/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    const res = await webhookRoute(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns 200 without updating when the status is absent", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const doc = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "x.pdf",
        s3_key: "k",
        docusign_envelope_id: "env-nostatus",
        docusign_status: "sent",
      },
    });
    const req = new Request("http://localhost/api/docusign/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "x",
        data: { envelopeId: "env-nostatus", envelopeSummary: {} },
      }),
    });
    const res = await webhookRoute(req);
    expect(res.status).toBe(200);
    const row = await prisma.documents.findUnique({ where: { id: doc.id } });
    expect(row?.docusign_status).toBe("sent"); // unchanged — no status to apply
  });
});

describe("POST /api/docusign/webhook (status automation + archival)", () => {
  async function seedEnvelope(opts: { purpose?: string } = {}) {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const buyer = await createUser({
      role: "buyer",
      auth0_id: "auth0|b",
      email: "mike@example.com",
      name: "Mike Smith",
    });
    const deal = await createDeal({ agent_id: agent.id });
    const doc = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "Buyer Agency Agreement",
        s3_key: "",
        purpose: opts.purpose ?? "",
        docusign_envelope_id: "env-auto",
        docusign_status: "sent",
      },
    });
    await prisma.docusign_recipients.createMany({
      data: [
        {
          document_id: doc.id,
          envelope_id: "env-auto",
          user_id: buyer.id,
          email: "mike@example.com",
          name: "Mike Smith",
          role: "Buyer",
          recipient_id: "1",
          routing_order: 1,
          status: "sent",
        },
        {
          document_id: doc.id,
          envelope_id: "env-auto",
          user_id: agent.id,
          email: "sarah@example.com",
          name: "Sarah Johnson",
          role: "Agent",
          recipient_id: "2",
          routing_order: 2,
          status: "sent",
        },
      ],
    });
    return { agent, buyer, deal, doc };
  }

  function webhookReq(payload: unknown) {
    return new Request("http://localhost/api/docusign/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  it("a recipient event updates the matching recipient row by email (case-insensitive)", async () => {
    const { doc } = await seedEnvelope();
    const res = await webhookRoute(
      webhookReq({
        event: "recipient-completed",
        data: {
          envelopeId: "env-auto",
          envelopeSummary: {
            status: "sent",
            recipients: {
              signers: [
                { email: "MIKE@Example.com", status: "completed", recipientId: "x9" },
                { email: "sarah@example.com", status: "delivered", recipientId: "x10" },
              ],
            },
          },
        },
      })
    );
    expect(res.status).toBe(200);

    const rows = await prisma.docusign_recipients.findMany({
      where: { document_id: doc.id },
      orderBy: { routing_order: "asc" },
    });
    expect(rows[0].status).toBe("completed");
    expect(rows[0].signed_at).not.toBeNull();
    expect(rows[1].status).toBe("delivered");
    expect(rows[1].signed_at).toBeNull();
  });

  it("envelope-completed archives the combined PDF to S3 and links it", async () => {
    const { doc } = await seedEnvelope();
    const res = await webhookRoute(
      webhookReq({
        event: "envelope-completed",
        data: {
          envelopeId: "env-auto",
          envelopeSummary: { status: "completed" },
        },
      })
    );
    expect(res.status).toBe(200);

    const puts = s3Mock.commandCalls(PutObjectCommand);
    expect(puts).toHaveLength(1);
    expect(puts[0].args[0].input.ContentType).toBe("application/pdf");

    const row = await prisma.documents.findUnique({ where: { id: doc.id } });
    expect(row?.docusign_status).toBe("completed");
    expect(row?.docusign_signed_s3_key).toBeTruthy();
    expect(row?.docusign_completed_at).not.toBeNull();
  });

  it("a duplicate completed delivery is idempotent (no second upload)", async () => {
    await seedEnvelope();
    const payload = {
      event: "envelope-completed",
      data: { envelopeId: "env-auto", envelopeSummary: { status: "completed" } },
    };
    await webhookRoute(webhookReq(payload));
    await webhookRoute(webhookReq(payload));
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);
  });

  it("completing a purpose='baa' document flips deals.baa_signed", async () => {
    const { deal } = await seedEnvelope({ purpose: "baa" });
    await webhookRoute(
      webhookReq({
        event: "envelope-completed",
        data: { envelopeId: "env-auto", envelopeSummary: { status: "completed" } },
      })
    );
    const row = await prisma.deals.findUnique({ where: { id: deal.id } });
    expect(row?.baa_signed).toBe(true);
  });
});

describe("POST /api/docusign/webhook (HMAC verification)", () => {
  const HMAC_KEY = "test-connect-hmac-key";
  let prevKey: string | undefined;

  beforeEach(() => {
    prevKey = process.env.DOCUSIGN_CONNECT_HMAC_KEY;
    process.env.DOCUSIGN_CONNECT_HMAC_KEY = HMAC_KEY;
    resetEnvForTesting();
  });
  afterEach(() => {
    if (prevKey === undefined) delete process.env.DOCUSIGN_CONNECT_HMAC_KEY;
    else process.env.DOCUSIGN_CONNECT_HMAC_KEY = prevKey;
    resetEnvForTesting();
  });

  function sign(body: string): string {
    return createHmac("sha256", HMAC_KEY).update(body, "utf8").digest("base64");
  }

  async function seedDoc() {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    return prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "x.pdf",
        s3_key: "k",
        docusign_envelope_id: "env-sig",
        docusign_status: "sent",
      },
    });
  }

  it("updates status when the signature is valid", async () => {
    const doc = await seedDoc();
    const body = JSON.stringify({
      data: { envelopeId: "env-sig", envelopeSummary: { status: "completed" } },
    });
    const req = new Request("http://localhost/api/docusign/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-docusign-signature-1": sign(body),
      },
      body,
    });
    const res = await webhookRoute(req);
    expect(res.status).toBe(200);
    const row = await prisma.documents.findUnique({ where: { id: doc.id } });
    expect(row?.docusign_status).toBe("completed");
  });

  it("rejects a forged/unsigned callback with 401 and does not update", async () => {
    const doc = await seedDoc();
    const body = JSON.stringify({
      data: { envelopeId: "env-sig", envelopeSummary: { status: "completed" } },
    });
    const req = new Request("http://localhost/api/docusign/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-docusign-signature-1": "not-a-valid-signature",
      },
      body,
    });
    const res = await webhookRoute(req);
    expect(res.status).toBe(401);
    const row = await prisma.documents.findUnique({ where: { id: doc.id } });
    expect(row?.docusign_status).toBe("sent"); // forged status not applied
  });

  it("rejects a tampered body whose signature was valid for a different body", async () => {
    const doc = await seedDoc();
    // Sign the benign body, then submit a different one under that signature —
    // proves the route verifies the RAW bytes it received, not a re-parse.
    const signedBody = JSON.stringify({
      data: { envelopeId: "env-sig", envelopeSummary: { status: "voided" } },
    });
    const tamperedBody = JSON.stringify({
      data: { envelopeId: "env-sig", envelopeSummary: { status: "completed" } },
    });
    const req = new Request("http://localhost/api/docusign/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-docusign-signature-1": sign(signedBody),
      },
      body: tamperedBody,
    });
    const res = await webhookRoute(req);
    expect(res.status).toBe(401);
    const row = await prisma.documents.findUnique({ where: { id: doc.id } });
    expect(row?.docusign_status).toBe("sent");
  });

  it("rejects when no signature header is present but a key is configured", async () => {
    const doc = await seedDoc();
    const body = JSON.stringify({
      data: { envelopeId: "env-sig", envelopeSummary: { status: "completed" } },
    });
    const req = new Request("http://localhost/api/docusign/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" }, // no signature header
      body,
    });
    const res = await webhookRoute(req);
    expect(res.status).toBe(401);
    const row = await prisma.documents.findUnique({ where: { id: doc.id } });
    expect(row?.docusign_status).toBe("sent");
  });
});
