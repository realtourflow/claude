import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { PDFDocument } from "pdf-lib";
import { POST as splitForm } from "@/app/api/admin/forms/[id]/split/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setS3ClientForTesting } from "@/lib/s3";
import {
  setVisionDetectorForTesting,
  type VisionFieldDetector,
} from "@/lib/form-ai/vision";
import { seedFormTypes, PURCHASE_AGREEMENT_KEY } from "@/lib/form-types-seed";
import { getBoss, stopBossForTesting } from "@/lib/queue";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/factories";

const s3Mock = mockClient(S3Client);
let FLAT3: Uint8Array;

const fakeDetector: VisionFieldDetector = {
  detect: async () => [],
  detectGuided: async () => [],
};

function bodyOf(bytes: Uint8Array): GetObjectCommandOutput["Body"] {
  return {
    transformToByteArray: async () => bytes,
  } as unknown as GetObjectCommandOutput["Body"];
}

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
  setS3ClientForTesting(
    new S3Client({
      region: "us-east-1",
      credentials: { accessKeyId: "t", secretAccessKey: "t" },
    }),
    "test-bucket"
  );
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.addPage([612, 792]);
  doc.addPage([612, 792]);
  FLAT3 = await doc.save();
  await getBoss(); // form-detect queue must exist before a child enqueues
});

afterAll(async () => {
  await stopBossForTesting();
});

beforeEach(async () => {
  await truncateAll();
  s3Mock.reset();
  s3Mock.on(PutObjectCommand).resolves({});
  s3Mock.on(DeleteObjectCommand).resolves({});
  s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 8192 });
  s3Mock.on(GetObjectCommand).resolves({ Body: bodyOf(FLAT3) });
  setVisionDetectorForTesting(fakeDetector);
  await seedFormTypes();
});

afterEach(() => {
  setVisionDetectorForTesting(undefined);
});

async function seedBundle(agentId: string, status = "pending_split") {
  const b = await prisma.uploaded_forms.create({
    data: {
      agent_id: agentId,
      label: "All buyer docs",
      side: "buy",
      board: "",
      source_s3_key: `agent-forms/${agentId}/1/bundle.pdf`,
      source_file_name: "bundle.pdf",
      file_sha256: "abc",
      detection_source: "bundle",
      status,
      attested_by: agentId,
      attestation_statement: "I attest.",
    },
    select: { id: true },
  });
  return b.id;
}

async function splitReq(id: string, sub: string, roles: string[], body: object) {
  return new Request(`http://localhost/api/admin/forms/${id}/split`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: await authHeader(sub, roles),
    },
    body: JSON.stringify(body),
  });
}

const part = (o: Partial<Record<string, unknown>> = {}) => ({
  start_page: 1,
  end_page: 1,
  form_type: PURCHASE_AGREEMENT_KEY,
  label: "Buyer Agency Agreement",
  side: "buy",
  ...o,
});

describe("admin bundle split", () => {
  it("403 for a non-admin", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedBundle(agent.id);
    const res = await splitForm(
      await splitReq(id, "auth0|a", ["agent"], { parts: [part()] }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(403);
  });

  it("409 when the form is not a bundle awaiting split", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedBundle(agent.id, "pending_review");
    const res = await splitForm(
      await splitReq(id, "auth0|admin", ["admin"], { parts: [part()] }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(409);
  });

  it("400 with no parts", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedBundle(agent.id);
    const res = await splitForm(
      await splitReq(id, "auth0|admin", ["admin"], { parts: [] }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(400);
  });

  it("400 when a page range is out of bounds", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedBundle(agent.id);
    const res = await splitForm(
      await splitReq(id, "auth0|admin", ["admin"], {
        parts: [part({ start_page: 2, end_page: 9 })], // only 3 pages
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(400);
  });

  it("carves a 3-page bundle into 2 child forms and archives the bundle", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedBundle(agent.id);

    const res = await splitForm(
      await splitReq(id, "auth0|admin", ["admin"], {
        parts: [
          part({ start_page: 1, end_page: 2, label: "Buyer Agency Agreement" }),
          part({ start_page: 3, end_page: 3, label: "Wire Fraud Advisory" }),
        ],
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);
    const out = (await res.json()) as {
      created: { id: string; label: string }[];
      failed: { label: string; error: string }[];
      page_count: number;
    };
    expect(out.page_count).toBe(3);
    expect(out.failed).toHaveLength(0);
    expect(out.created).toHaveLength(2);

    // Bundle is archived; two children exist, owned by the same agent, flat →
    // vision 'detecting', each with its own carved source key (not the bundle's).
    const bundle = await prisma.uploaded_forms.findUniqueOrThrow({ where: { id } });
    expect(bundle.status).toBe("split");

    const children = await prisma.uploaded_forms.findMany({
      where: { id: { in: out.created.map((c) => c.id) } },
    });
    expect(children).toHaveLength(2);
    for (const c of children) {
      expect(c.agent_id).toBe(agent.id);
      expect(c.status).toBe("detecting");
      expect(c.detection_source).toBe("vision");
      expect(c.form_type_id).not.toBeNull();
      expect(c.source_s3_key).not.toBe(bundle.source_s3_key);
    }
    expect(children.map((c) => c.label).sort()).toEqual([
      "Buyer Agency Agreement",
      "Wire Fraud Advisory",
    ]);
  });
});
