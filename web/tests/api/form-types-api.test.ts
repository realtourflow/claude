import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { PDFDocument } from "pdf-lib";
import { GET as listFormTypes } from "@/app/api/me/form-types/route";
import { POST as createForm } from "@/app/api/me/forms/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setS3ClientForTesting } from "@/lib/s3";
import { setFieldMapperForTesting } from "@/lib/form-ai/mapper";
import type { FieldMapper } from "@/lib/form-ai/types";
import { seedFormTypes, PURCHASE_AGREEMENT_KEY } from "@/lib/form-types-seed";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/factories";

const s3Mock = mockClient(S3Client);
let FILLABLE: Uint8Array;

const fakeMapper: FieldMapper = {
  proposeMappings: async ({ fields }) =>
    fields.map(() => ({ coreKey: null, role: null, confidence: 0, rationale: "" })),
};

function bodyOf(bytes: Uint8Array): GetObjectCommandOutput["Body"] {
  return { transformToByteArray: async () => bytes } as unknown as GetObjectCommandOutput["Body"];
}

async function makeFillable(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  doc.getForm().createTextField("buyer").addToPage(page, { x: 72, y: 700, width: 200, height: 18 });
  return doc.save();
}

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
  setS3ClientForTesting(
    new S3Client({ region: "us-east-1", credentials: { accessKeyId: "t", secretAccessKey: "t" } }),
    "test-bucket"
  );
  FILLABLE = await makeFillable();
});

beforeEach(async () => {
  await truncateAll();
  s3Mock.reset();
  s3Mock.on(PutObjectCommand).resolves({});
  s3Mock.on(DeleteObjectCommand).resolves({});
  s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 4096 });
  s3Mock.on(GetObjectCommand).resolves({ Body: bodyOf(FILLABLE) });
  setFieldMapperForTesting(fakeMapper);
  await seedFormTypes();
});

afterEach(() => {
  s3Mock.reset();
  setFieldMapperForTesting(undefined);
});

async function getTypes() {
  return listFormTypes(
    new Request("http://localhost/api/me/form-types", {
      headers: { authorization: await authHeader("auth0|t", ["agent"]) },
    })
  );
}

async function postForm(agentId: string, formType?: string) {
  return createForm(
    new Request("http://localhost/api/me/forms", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: await authHeader("auth0|t", ["agent"]) },
      body: JSON.stringify({
        label: "My PA",
        side: "buy",
        file_name: "pa.pdf",
        s3_key: `agent-forms/${agentId}/1/pa.pdf`,
        mime_type: "application/pdf",
        attestation: true,
        ...(formType !== undefined ? { form_type: formType } : {}),
      }),
    })
  );
}

describe("form types — pick-the-type upload (Phase 2)", () => {
  it("GET /api/me/form-types lists active types (no field_set leaked)", async () => {
    const res = await getTypes();
    expect(res.status).toBe(200);
    const types = (await res.json()) as Array<Record<string, unknown>>;
    const pa = types.find((t) => t.key === PURCHASE_AGREEMENT_KEY)!;
    expect(pa).toBeTruthy();
    expect(pa.label).toBe("Purchase Agreement");
    expect(pa.field_count).toBe(100);
    expect(pa).not.toHaveProperty("field_set"); // only the pickable label, not the answer key
  });

  
// Uploading requires a declared company + market (the profile gate).
async function onboard(agentId: string) {
  await prisma.users.update({
    where: { id: agentId },
    data: { brokerage: "ARC Realty", market: "BIRMINGHAM_AAR", markets: ["BIRMINGHAM_AAR"] },
  });
}

it("upload with a valid form_type records the type link", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|t" });
    await onboard(agent.id);
    const res = await postForm(agent.id, PURCHASE_AGREEMENT_KEY);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    const type = await prisma.form_types.findUniqueOrThrow({ where: { key: PURCHASE_AGREEMENT_KEY } });
    const form = await prisma.uploaded_forms.findUniqueOrThrow({ where: { id } });
    expect(form.form_type_id).toBe(type.id);
  });

  it("rejects an unknown form_type with 400 (and never creates the form)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|t" });
    const res = await postForm(agent.id, "not_a_real_type");
    expect(res.status).toBe(400);
    expect(await prisma.uploaded_forms.count()).toBe(0);
  });

  it("still accepts an upload with no form_type (type link null)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|t" });
    await onboard(agent.id);
    const res = await postForm(agent.id);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const form = await prisma.uploaded_forms.findUniqueOrThrow({ where: { id } });
    expect(form.form_type_id).toBeNull();
  });
});
