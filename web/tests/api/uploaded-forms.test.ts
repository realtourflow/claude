import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { PDFDocument } from "pdf-lib";
import { GET as listForms, POST as createForm } from "@/app/api/me/forms/route";
import { POST as uploadUrl } from "@/app/api/me/forms/upload-url/route";
import { GET as formDetail } from "@/app/api/me/forms/[id]/route";
import { GET as attestation } from "@/app/api/me/forms/attestation/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setS3ClientForTesting } from "@/lib/s3";
import { setFieldMapperForTesting } from "@/lib/form-ai/mapper";
import type { FieldMapper } from "@/lib/form-ai/types";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/factories";

const s3Mock = mockClient(S3Client);

let FILLABLE: Uint8Array;
let FLAT: Uint8Array;

// Maps the first detected field to buyer_name (high confidence) and leaves the
// rest unmapped — deterministic stand-in for the real Claude mapper.
const fakeMapper: FieldMapper = {
  proposeMappings: async ({ fields }) =>
    fields.map((_, i) =>
      i === 0
        ? { coreKey: "buyer_name", role: "Buyer", confidence: 0.95, rationale: "named buyer" }
        : { coreKey: null, role: null, confidence: 0, rationale: "" }
    ),
};

function bodyOf(bytes: Uint8Array): GetObjectCommandOutput["Body"] {
  return {
    transformToByteArray: async () => bytes,
  } as unknown as GetObjectCommandOutput["Body"];
}

async function makeFillable(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  form.createTextField("buyer_name").addToPage(page, { x: 72, y: 700, width: 200, height: 18 });
  form.createCheckBox("agree").addToPage(page, { x: 72, y: 660, width: 12, height: 12 });
  return doc.save();
}

async function makeFlat(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
  const client = new S3Client({
    region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  setS3ClientForTesting(client, "test-bucket");
  FILLABLE = await makeFillable();
  FLAT = await makeFlat();
});

beforeEach(async () => {
  await truncateAll();
  s3Mock.reset();
  s3Mock.on(PutObjectCommand).resolves({});
  s3Mock.on(DeleteObjectCommand).resolves({});
  s3Mock.on(GetObjectCommand).resolves({ Body: bodyOf(FILLABLE) });
  setFieldMapperForTesting(fakeMapper);
});

afterEach(async () => {
  s3Mock.reset();
  setFieldMapperForTesting(undefined);
  await prisma.system_config.deleteMany({});
});

// Build a confirm Request with a real auth header for the given agent.
async function postForm(agentId: string, sub: string, label = "Listing Agreement") {
  return new Request("http://localhost/api/me/forms", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: await authHeader(sub, ["agent"]),
    },
    body: JSON.stringify({
      label,
      side: "sell",
      file_name: "listing.pdf",
      s3_key: `agent-forms/${agentId}/123/listing.pdf`,
      mime_type: "application/pdf",
      attestation: true,
    }),
  });
}

describe("POST /api/me/forms/upload-url", () => {
  it("returns a pre-signed PUT url and an agent-forms key", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const req = new Request("http://localhost/api/me/forms/upload-url", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ file_name: "listing.pdf", mime_type: "application/pdf" }),
    });
    const res = await uploadUrl(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { upload_url: string; s3_key: string };
    expect(body.s3_key).toMatch(
      new RegExp(`^agent-forms/${agent.id}/\\d+/listing\\.pdf$`)
    );
  });

  it("401 without a token", async () => {
    const req = new Request("http://localhost/api/me/forms/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file_name: "x.pdf" }),
    });
    expect((await uploadUrl(req)).status).toBe(401);
  });
});

describe("POST /api/me/forms (confirm + pipeline)", () => {
  it("creates a pending_review form, records the attestation, runs the pipeline", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const res = await createForm(await postForm(agent.id, "auth0|a"));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      status: string;
      field_count: number;
      needs_review_count: number;
    };
    expect(body.status).toBe("pending_review");
    expect(body.field_count).toBe(2);
    expect(body.needs_review_count).toBe(1);

    const row = await prisma.uploaded_forms.findUnique({ where: { id: body.id } });
    expect(row?.agent_id).toBe(agent.id);
    expect(row?.attested_by).toBe(agent.id);
    expect(row?.attestation_statement).toBe(
      "I attest that I am licensed and permitted to use and host this form."
    );
    expect(row?.file_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.docusign_template_id).toBeNull();

    const fields = await prisma.uploaded_form_fields.findMany({
      where: { form_id: body.id },
    });
    expect(fields).toHaveLength(2);
    const buyer = fields.find((f) => f.detected_name === "buyer_name")!;
    expect(buyer.ai_core_key).toBe("buyer_name");
    expect(buyer.needs_review).toBe(false);
    const agree = fields.find((f) => f.detected_name === "agree")!;
    expect(agree.ai_core_key).toBeNull();
    expect(agree.needs_review).toBe(true);
  });

  it("captures board = the agent's market at upload", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await prisma.users.update({
      where: { id: agent.id },
      data: { market: "BALDWIN" },
    });
    const res = await createForm(await postForm(agent.id, "auth0|a"));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const row = await prisma.uploaded_forms.findUnique({ where: { id } });
    expect(row?.board).toBe("BALDWIN");
  });

  it("400 when the licensing attestation is not checked", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const req = new Request("http://localhost/api/me/forms", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({
        label: "Listing",
        side: "sell",
        s3_key: `agent-forms/${agent.id}/123/listing.pdf`,
        attestation: false,
      }),
    });
    expect((await createForm(req)).status).toBe(400);
    expect(await prisma.uploaded_forms.count()).toBe(0);
  });

  it("422 for a flat PDF with no fillable fields, and persists nothing", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    s3Mock.on(GetObjectCommand).resolves({ Body: bodyOf(FLAT) });
    const res = await createForm(await postForm(agent.id, "auth0|a"));
    expect(res.status).toBe(422);
    expect(await prisma.uploaded_forms.count()).toBe(0);
  });

  it("400 when the s3_key is outside the caller's namespace", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const req = new Request("http://localhost/api/me/forms", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({
        label: "Listing",
        side: "sell",
        s3_key: "agent-forms/someone-else/123/listing.pdf",
        attestation: true,
      }),
    });
    expect((await createForm(req)).status).toBe(400);
  });
});

describe("GET /api/me/forms", () => {
  it("returns only the caller's forms with counts", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const other = await createUser({ role: "agent", auth0_id: "auth0|other" });
    await createForm(await postForm(agent.id, "auth0|a"));
    await createForm(await postForm(other.id, "auth0|other"));

    const res = await listForms(
      new Request("http://localhost/api/me/forms", {
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      field_count: number;
      needs_review_count: number;
    }>;
    expect(body).toHaveLength(1);
    expect(body[0].field_count).toBe(2);
    expect(body[0].needs_review_count).toBe(1);
  });
});

describe("GET /api/me/forms/:id", () => {
  it("owner sees fields; a non-owner gets 404", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await createUser({ role: "agent", auth0_id: "auth0|other" });
    const created = await createForm(await postForm(agent.id, "auth0|a"));
    const { id } = (await created.json()) as { id: string };

    const ownerRes = await formDetail(
      new Request(`http://localhost/api/me/forms/${id}`, {
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(ownerRes.status).toBe(200);
    const detail = (await ownerRes.json()) as { fields: unknown[] };
    expect(detail.fields).toHaveLength(2);

    const otherRes = await formDetail(
      new Request(`http://localhost/api/me/forms/${id}`, {
        headers: { authorization: await authHeader("auth0|other", ["agent"]) },
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(otherRes.status).toBe(404);
  });
});

describe("GET /api/me/forms/attestation", () => {
  it("returns the default, then the admin-configured wording", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin" });

    const first = await attestation(
      new Request("http://localhost/api/me/forms/attestation", {
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      })
    );
    expect(((await first.json()) as { statement: string }).statement).toMatch(
      /licensed and permitted/
    );

    await prisma.system_config.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        config: { form_attestation_statement: "Custom wording v2." },
        updated_by: admin.id,
      },
      update: {
        config: { form_attestation_statement: "Custom wording v2." },
        updated_by: admin.id,
      },
    });

    const second = await attestation(
      new Request("http://localhost/api/me/forms/attestation", {
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      })
    );
    expect(((await second.json()) as { statement: string }).statement).toBe(
      "Custom wording v2."
    );
  });
});
