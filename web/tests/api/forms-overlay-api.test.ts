import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, GetObjectCommand, type GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { PDFDocument } from "pdf-lib";
import { GET as pageImage } from "@/app/api/admin/forms/[id]/page-image/route";
import { GET as formDetail } from "@/app/api/admin/forms/[id]/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setS3ClientForTesting } from "@/lib/s3";
import { seedFormTypes, resolveFormTypeId, PURCHASE_AGREEMENT_KEY } from "@/lib/form-types-seed";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/factories";

const s3Mock = mockClient(S3Client);
let PDF: Uint8Array;

function bodyOf(bytes: Uint8Array): GetObjectCommandOutput["Body"] {
  return { transformToByteArray: async () => bytes } as unknown as GetObjectCommandOutput["Body"];
}

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
  setS3ClientForTesting(
    new S3Client({ region: "us-east-1", credentials: { accessKeyId: "t", secretAccessKey: "t" } }),
    "test-bucket"
  );
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  PDF = await doc.save();
});

beforeEach(async () => {
  await truncateAll();
  s3Mock.reset();
  s3Mock.on(GetObjectCommand).resolves({ Body: bodyOf(PDF) });
  await seedFormTypes();
});

async function seedVisionForm(agentId: string): Promise<string> {
  const typeId = await resolveFormTypeId(PURCHASE_AGREEMENT_KEY);
  const form = await prisma.uploaded_forms.create({
    data: {
      agent_id: agentId,
      label: "PA",
      side: "buy",
      source_s3_key: `agent-forms/${agentId}/1/pa.pdf`,
      source_file_name: "pa.pdf",
      attested_by: agentId,
      attestation_statement: "a",
      file_sha256: "x",
      status: "pending_review",
      detection_source: "vision",
      form_type_id: typeId,
    },
    select: { id: true },
  });
  await prisma.uploaded_form_fields.createMany({
    data: [
      { form_id: form.id, detected_name: "buyer_name", detected_type: "text", page_number: 1, pos_x: 72, pos_y: 700, width: 200, height: 18, needs_review: false, decision: "accepted" },
      { form_id: form.id, detected_name: "mls_id", detected_type: "text", page_number: 1, pos_x: 400, pos_y: 600, width: 80, height: 18, needs_review: false, decision: "accepted" },
    ],
  });
  return form.id;
}

const adminHdr = () => authHeader("auth0|admin", ["admin"]);

describe("overlay review API (Phase 3, pt 3)", () => {
  beforeEach(async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
  });

  it("page-image renders a PNG for an admin", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedVisionForm(agent.id);
    const res = await pageImage(
      new Request(`http://localhost/api/admin/forms/${id}/page-image?page=1`, {
        headers: { authorization: await adminHdr() },
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(100);
    expect(buf.subarray(1, 4).toString()).toBe("PNG");
  });

  it("page-image is admin-only (403) and validates the page (400)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedVisionForm(agent.id);
    const forbidden = await pageImage(
      new Request(`http://localhost/api/admin/forms/${id}/page-image?page=1`, {
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(forbidden.status).toBe(403);

    const bad = await pageImage(
      new Request(`http://localhost/api/admin/forms/${id}/page-image?page=0`, {
        headers: { authorization: await adminHdr() },
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(bad.status).toBe(400);
  });

  it("detail carries per-field tier, page sizes, and the gate fields the overlay needs", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedVisionForm(agent.id);
    const res = await formDetail(
      new Request(`http://localhost/api/admin/forms/${id}`, { headers: { authorization: await adminHdr() } }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);
    const d = (await res.json()) as {
      detection_source: string;
      placement_confirmed_at: string | null;
      pages: Array<{ page: number; width: number; height: number }>;
      fields: Array<{ detected_name: string; tier: string; pos_x: number }>;
    };
    expect(d.detection_source).toBe("vision");
    expect(d.placement_confirmed_at).toBeNull();
    expect(d.pages[0]).toMatchObject({ page: 1, width: 612, height: 792 });
    // tier comes from the purchase_agreement type field set
    expect(d.fields.find((f) => f.detected_name === "buyer_name")!.tier).toBe("core");
    expect(d.fields.find((f) => f.detected_name === "mls_id")!.tier).toBe("common");
    expect(d.fields.find((f) => f.detected_name === "buyer_name")!.pos_x).toBe(72);
  });
});
