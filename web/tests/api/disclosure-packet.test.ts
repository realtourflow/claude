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
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { StreamingBlobPayloadOutputTypes } from "@smithy/types";
import { PDFDocument } from "pdf-lib";
import { POST as disclosurePacketRoute } from "@/app/api/deals/[id]/disclosure-packet/route";
import { POST as webhookRoute } from "@/app/api/docusign/webhook/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setS3ClientForTesting } from "@/lib/s3";
import {
  setDocusignForTesting,
  type DocusignClient,
  type DocusignSigner,
} from "@/lib/docusign";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser, createDeal } from "../helpers/factories";

const s3Mock = mockClient(S3Client);

// In-memory DocuSign fake. Records every createEnvelope call (so tests can
// assert exactly one envelope was created) and can be told to fail.
type FakeDocusign = DocusignClient & {
  enabledValue: boolean;
  failCreate: boolean;
  createCalls: {
    docName: string;
    bytes: Uint8Array;
    signers: DocusignSigner[];
  }[];
};

function makeFakeDocusign(): FakeDocusign {
  const fake: FakeDocusign = {
    enabledValue: true,
    failCreate: false,
    createCalls: [],
    enabled() {
      return fake.enabledValue;
    },
    async createEnvelope(docName, bytes, signers) {
      if (fake.failCreate) throw new Error("docusign down");
      fake.createCalls.push({ docName, bytes, signers });
      return "env-packet-123";
    },
    async createTemplateEnvelope() {
      throw new Error("disclosure packets never use the template path");
    },
    async getEnvelopeStatus() {
      return "sent";
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

/** Builds a real tiny PDF with the given page count using pdf-lib itself. */
async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([200, 200]);
  return doc.save();
}

/**
 * Seeds a documents row + an S3 GetObject mock that returns real PDF bytes
 * for the row's key.
 */
async function seedPdfDoc(input: {
  dealId: string;
  uploadedBy: string;
  name: string;
  pages: number;
}): Promise<{ id: string; s3_key: string; bytes: Uint8Array }> {
  const bytes = await makePdf(input.pages);
  const key = `deals/${input.dealId}/${Date.now()}/${input.name}`;
  s3Mock
    .on(GetObjectCommand, { Bucket: "test-bucket", Key: key })
    .resolves({ Body: bodyOf(bytes) });
  const doc = await prisma.documents.create({
    data: {
      deal_id: input.dealId,
      uploaded_by: input.uploadedBy,
      name: input.name,
      s3_key: key,
      mime_type: "application/pdf",
      file_size: bytes.length,
    },
    select: { id: true, s3_key: true },
  });
  return { ...doc, bytes };
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
  s3Mock.on(PutObjectCommand).resolves({});
  s3Mock.on(DeleteObjectCommand).resolves({});
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

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function packetRequest(
  dealId: string,
  body: unknown,
  auth?: string
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (auth) headers.authorization = auth;
  return new Request(`http://localhost/api/deals/${dealId}/disclosure-packet`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const SIGNER = { email: "buyer@example.com", name: "Buyer One" };

describe("POST /api/deals/[id]/disclosure-packet", () => {
  it("merges the selected PDFs into one packet stored in S3 + a new documents row", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const docA = await seedPdfDoc({
      dealId: deal.id,
      uploadedBy: agent.id,
      name: "Seller Disclosures.pdf",
      pages: 1,
    });
    const docB = await seedPdfDoc({
      dealId: deal.id,
      uploadedBy: agent.id,
      name: "Lead Paint Addendum.pdf",
      pages: 2,
    });

    const res = await disclosurePacketRoute(
      packetRequest(
        deal.id,
        { document_ids: [docA.id, docB.id], signer: SIGNER },
        await authHeader("auth0|a", ["agent"])
      ),
      ctx(deal.id)
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      name: string;
      mime_type: string;
      file_size: number;
      s3_key: string;
      uploader_name: string;
      docusign_envelope_id: string;
      docusign_status: string;
    };
    expect(body.name).toMatch(/^Disclosure Packet — \w{3} \d{1,2}, \d{4}$/);
    expect(body.mime_type).toBe("application/pdf");
    expect(body.docusign_envelope_id).toBe("env-packet-123");
    expect(body.docusign_status).toBe("sent");

    // S3 received exactly one put with the merged PDF (pages of A + B).
    const puts = s3Mock.commandCalls(PutObjectCommand);
    expect(puts.length).toBe(1);
    const put = puts[0].args[0].input;
    expect(put.Bucket).toBe("test-bucket");
    expect(put.Key).toMatch(new RegExp(`^deals/${deal.id}/`));
    expect(put.ContentType).toBe("application/pdf");
    const merged = await PDFDocument.load(put.Body as Uint8Array);
    expect(merged.getPageCount()).toBe(3);
    expect(body.file_size).toBe((put.Body as Uint8Array).length);

    // The packet exists as a regular documents row on this deal.
    const row = await prisma.documents.findUnique({ where: { id: body.id } });
    expect(row?.deal_id).toBe(deal.id);
    expect(row?.uploaded_by).toBe(agent.id);
    expect(row?.name).toBe(body.name);
    expect(row?.mime_type).toBe("application/pdf");
    expect(Number(row?.file_size)).toBe(body.file_size);
    expect(row?.s3_key).toBe(put.Key);
    expect(row?.docusign_envelope_id).toBe("env-packet-123");
    expect(row?.docusign_status).toBe("sent");
    expect(row?.docusign_sent_at).not.toBeNull();
  });

  it("creates exactly one envelope with the signer from the body", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const docA = await seedPdfDoc({
      dealId: deal.id,
      uploadedBy: agent.id,
      name: "a.pdf",
      pages: 1,
    });
    const docB = await seedPdfDoc({
      dealId: deal.id,
      uploadedBy: agent.id,
      name: "b.pdf",
      pages: 1,
    });

    const res = await disclosurePacketRoute(
      packetRequest(
        deal.id,
        { document_ids: [docA.id, docB.id], signer: SIGNER },
        await authHeader("auth0|a", ["agent"])
      ),
      ctx(deal.id)
    );
    expect(res.status).toBe(201);

    expect(fakeDocusign.createCalls.length).toBe(1);
    const call = fakeDocusign.createCalls[0];
    expect(call.signers).toEqual([SIGNER]);
    expect(call.docName).toMatch(/^Disclosure Packet — /);
    // The envelope carries the merged packet, not an individual document.
    const sent = await PDFDocument.load(call.bytes);
    expect(sent.getPageCount()).toBe(2);
  });

  it("the existing DocuSign webhook updates the packet's status", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const docA = await seedPdfDoc({
      dealId: deal.id,
      uploadedBy: agent.id,
      name: "a.pdf",
      pages: 1,
    });

    const res = await disclosurePacketRoute(
      packetRequest(
        deal.id,
        { document_ids: [docA.id], signer: SIGNER },
        await authHeader("auth0|a", ["agent"])
      ),
      ctx(deal.id)
    );
    expect(res.status).toBe(201);
    const packet = (await res.json()) as {
      id: string;
      docusign_envelope_id: string;
    };

    const hookRes = await webhookRoute(
      new Request("http://localhost/api/docusign/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event: "envelope-completed",
          data: {
            envelopeId: packet.docusign_envelope_id,
            envelopeSummary: { status: "completed" },
          },
        }),
      })
    );
    expect(hookRes.status).toBe(200);

    const row = await prisma.documents.findUnique({
      where: { id: packet.id },
    });
    expect(row?.docusign_status).toBe("completed");
  });

  it("401 when unauthenticated", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const res = await disclosurePacketRoute(
      packetRequest(deal.id, { document_ids: ["x"], signer: SIGNER }),
      ctx(deal.id)
    );
    expect(res.status).toBe(401);
  });

  it("404 when caller is not the owning agent", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const stranger = await createUser({ role: "agent", auth0_id: "auth0|s" });
    void stranger;
    const deal = await createDeal({ agent_id: agent.id });
    const docA = await seedPdfDoc({
      dealId: deal.id,
      uploadedBy: agent.id,
      name: "a.pdf",
      pages: 1,
    });

    const res = await disclosurePacketRoute(
      packetRequest(
        deal.id,
        { document_ids: [docA.id], signer: SIGNER },
        await authHeader("auth0|s", ["agent"])
      ),
      ctx(deal.id)
    );
    expect(res.status).toBe(404);
    expect(fakeDocusign.createCalls.length).toBe(0);
  });

  it("404 for a buyer participant (agent-only route)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const buyer = await createUser({ role: "buyer", auth0_id: "auth0|b" });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });
    const docA = await seedPdfDoc({
      dealId: deal.id,
      uploadedBy: agent.id,
      name: "a.pdf",
      pages: 1,
    });

    const res = await disclosurePacketRoute(
      packetRequest(
        deal.id,
        { document_ids: [docA.id], signer: SIGNER },
        await authHeader("auth0|b", ["buyer"])
      ),
      ctx(deal.id)
    );
    expect(res.status).toBe(404);
    expect(fakeDocusign.createCalls.length).toBe(0);
  });

  it("rejects a document_id from another deal — no envelope, no packet row", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const otherDeal = await createDeal({ agent_id: agent.id });
    const docA = await seedPdfDoc({
      dealId: deal.id,
      uploadedBy: agent.id,
      name: "a.pdf",
      pages: 1,
    });
    const foreign = await seedPdfDoc({
      dealId: otherDeal.id,
      uploadedBy: agent.id,
      name: "foreign.pdf",
      pages: 1,
    });

    const res = await disclosurePacketRoute(
      packetRequest(
        deal.id,
        { document_ids: [docA.id, foreign.id], signer: SIGNER },
        await authHeader("auth0|a", ["agent"])
      ),
      ctx(deal.id)
    );
    expect([400, 404]).toContain(res.status);
    expect(fakeDocusign.createCalls.length).toBe(0);
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
    const packets = await prisma.documents.count({
      where: { name: { startsWith: "Disclosure Packet" } },
    });
    expect(packets).toBe(0);
  });

  it("400 naming the non-PDF document when one is included", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const docA = await seedPdfDoc({
      dealId: deal.id,
      uploadedBy: agent.id,
      name: "a.pdf",
      pages: 1,
    });
    const csv = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "comps.csv",
        s3_key: "deals/x/comps.csv",
        mime_type: "text/csv",
        file_size: 10,
      },
      select: { id: true },
    });

    const res = await disclosurePacketRoute(
      packetRequest(
        deal.id,
        { document_ids: [docA.id, csv.id], signer: SIGNER },
        await authHeader("auth0|a", ["agent"])
      ),
      ctx(deal.id)
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("comps.csv");
    expect(fakeDocusign.createCalls.length).toBe(0);
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
  });

  it("400 when document_ids is empty", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });

    const res = await disclosurePacketRoute(
      packetRequest(
        deal.id,
        { document_ids: [], signer: SIGNER },
        await authHeader("auth0|a", ["agent"])
      ),
      ctx(deal.id)
    );
    expect(res.status).toBe(400);
    expect(fakeDocusign.createCalls.length).toBe(0);
  });

  it("400 when the signer is missing email or name", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const docA = await seedPdfDoc({
      dealId: deal.id,
      uploadedBy: agent.id,
      name: "a.pdf",
      pages: 1,
    });

    const res = await disclosurePacketRoute(
      packetRequest(
        deal.id,
        { document_ids: [docA.id], signer: { email: "", name: "" } },
        await authHeader("auth0|a", ["agent"])
      ),
      ctx(deal.id)
    );
    expect(res.status).toBe(400);
    expect(fakeDocusign.createCalls.length).toBe(0);
  });

  it("502 + packet row cleaned up when DocuSign fails after the row exists", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const docA = await seedPdfDoc({
      dealId: deal.id,
      uploadedBy: agent.id,
      name: "a.pdf",
      pages: 1,
    });
    fakeDocusign.failCreate = true;

    const res = await disclosurePacketRoute(
      packetRequest(
        deal.id,
        { document_ids: [docA.id], signer: SIGNER },
        await authHeader("auth0|a", ["agent"])
      ),
      ctx(deal.id)
    );
    expect(res.status).toBe(502);

    // No orphan half-sent packet row remains; the original doc is untouched.
    const packets = await prisma.documents.count({
      where: { name: { startsWith: "Disclosure Packet" } },
    });
    expect(packets).toBe(0);
    const original = await prisma.documents.findUnique({
      where: { id: docA.id },
    });
    expect(original).not.toBeNull();

    // The uploaded S3 object was cleaned up (best-effort delete fired).
    const puts = s3Mock.commandCalls(PutObjectCommand);
    expect(puts.length).toBe(1);
    const deletes = s3Mock.commandCalls(DeleteObjectCommand);
    expect(deletes.length).toBe(1);
    expect(deletes[0].args[0].input.Key).toBe(puts[0].args[0].input.Key);
  });
});
