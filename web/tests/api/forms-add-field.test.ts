import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { PDFDocument } from "pdf-lib";
import { POST as addField } from "@/app/api/admin/forms/[id]/fields/route";
import { DELETE as deleteField } from "@/app/api/admin/forms/[id]/fields/[fieldId]/route";
import { GET as formDetail } from "@/app/api/admin/forms/[id]/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setStorageForTesting, type TestStorage } from "@/lib/blob-storage";
import { seedFormTypes, resolveFormTypeId, PURCHASE_AGREEMENT_KEY } from "@/lib/form-types-seed";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/factories";

let storage: TestStorage;
let PDF: Uint8Array;


beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  PDF = await doc.save();
});

beforeEach(async () => {
  await truncateAll();
  storage = setStorageForTesting()!;
  storage.defaultBytes = PDF;
  await seedFormTypes();
  await createUser({ role: "admin", auth0_id: "auth0|admin" });
});

const adminHdr = () => authHeader("auth0|admin", ["admin"]);

// A pending_review vision form with its placement ALREADY confirmed — so we can
// prove that adding/removing a field re-arms the gate (clears the confirmation).
async function seedConfirmedForm(): Promise<{ id: string; agentId: string }> {
  const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
  const typeId = await resolveFormTypeId(PURCHASE_AGREEMENT_KEY);
  const form = await prisma.uploaded_forms.create({
    data: {
      agent_id: agent.id,
      label: "PA",
      side: "buy",
      source_s3_key: `agent-forms/${agent.id}/1/pa.pdf`,
      source_file_name: "pa.pdf",
      attested_by: agent.id,
      attestation_statement: "a",
      file_sha256: "x",
      status: "pending_review",
      detection_source: "vision",
      form_type_id: typeId,
      placement_confirmed_at: new Date(),
      placement_confirmed_by: agent.id,
    },
    select: { id: true },
  });
  await prisma.uploaded_form_fields.create({
    data: { form_id: form.id, detected_name: "buyer_name", detected_type: "text", page_number: 1, pos_x: 72, pos_y: 700, width: 200, height: 18, needs_review: false, decision: "accepted" },
  });
  return { id: form.id, agentId: agent.id };
}

const addReq = async (id: string, body: object) =>
  new Request(`http://localhost/api/admin/forms/${id}/fields`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: await adminHdr() },
    body: JSON.stringify(body),
  });

const delReq = async (id: string, fieldId: string, hdr = adminHdr()) =>
  new Request(`http://localhost/api/admin/forms/${id}/fields/${fieldId}`, {
    method: "DELETE",
    headers: { authorization: await hdr },
  });

describe("admin adds a missing field", () => {
  it("creates the field at the given spot, marks it accepted, and RE-ARMS the gate", async () => {
    const { id } = await seedConfirmedForm();
    const res = await addField(
      await addReq(id, { detected_name: "seller_name", detected_type: "text", page_number: 1, pos_x: 100, pos_y: 500, width: 170, height: 16 }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; detected_name: string; decision: string; needs_review: boolean };
    expect(created.detected_name).toBe("seller_name");
    expect(created.decision).toBe("accepted");
    expect(created.needs_review).toBe(false);

    const row = await prisma.uploaded_form_fields.findFirstOrThrow({ where: { form_id: id, detected_name: "seller_name" } });
    expect(Number(row.pos_x)).toBe(100);
    expect(Number(row.pos_y)).toBe(500);

    // The mandatory placement gate must re-arm: a new box wasn't part of the prior sign-off.
    const form = await prisma.uploaded_forms.findUniqueOrThrow({ where: { id } });
    expect(form.placement_confirmed_at).toBeNull();
  });

  it("a type-list field comes back through the detail with the right tier; the detail exposes the master list", async () => {
    const { id } = await seedConfirmedForm();
    await addField(await addReq(id, { detected_name: "seller_name", detected_type: "text", page_number: 1 }), {
      params: Promise.resolve({ id }),
    });
    const res = await formDetail(
      new Request(`http://localhost/api/admin/forms/${id}`, { headers: { authorization: await adminHdr() } }),
      { params: Promise.resolve({ id }) }
    );
    const d = (await res.json()) as {
      type_fields: Array<{ label: string; tier: string }>;
      fields: Array<{ detected_name: string; tier: string }>;
    };
    expect(d.type_fields.length).toBeGreaterThan(10);
    expect(d.type_fields.some((t) => t.label === "buyer_name")).toBe(true);
    expect(d.fields.find((f) => f.detected_name === "seller_name")!.tier).toBe("core");
  });

  it("a CUSTOM field (new label) joins the type's master list — searchable on future forms", async () => {
    const { id } = await seedConfirmedForm();
    await addField(
      await addReq(id, { detected_name: "wire_instructions_ack", detected_type: "checkbox", page_number: 1 }),
      { params: Promise.resolve({ id }) }
    );
    // The picker reads the type's field_set (type_fields) — the custom field is now in it.
    const res = await formDetail(
      new Request(`http://localhost/api/admin/forms/${id}`, { headers: { authorization: await adminHdr() } }),
      { params: Promise.resolve({ id }) }
    );
    const d = (await res.json()) as { type_fields: Array<{ label: string; type: string; source?: string; tier: string }> };
    const tf = d.type_fields.find((t) => t.label === "wire_instructions_ack");
    expect(tf).toBeTruthy();
    expect(tf!.type).toBe("checkbox");
    expect(tf!.tier).toBe("common");
    // And it's persisted on the shared type row, not just this form.
    const ft = await prisma.form_types.findFirstOrThrow({ where: { key: PURCHASE_AGREEMENT_KEY } });
    const set = ft.field_set as Array<{ label: string }>;
    expect(set.some((f) => f.label === "wire_instructions_ack")).toBe(true);
  });

  it("picking a field already on the master list does NOT duplicate it", async () => {
    const { id } = await seedConfirmedForm();
    await addField(await addReq(id, { detected_name: "buyer_name", detected_type: "text", page_number: 1 }), {
      params: Promise.resolve({ id }),
    });
    const ft = await prisma.form_types.findFirstOrThrow({ where: { key: PURCHASE_AGREEMENT_KEY } });
    const set = ft.field_set as Array<{ label: string }>;
    expect(set.filter((f) => f.label === "buyer_name")).toHaveLength(1);
  });

  it("validates name/type/page/core_key, and refuses a non-pending form", async () => {
    const { id } = await seedConfirmedForm();
    const noName = await addField(await addReq(id, { detected_name: "  " }), { params: Promise.resolve({ id }) });
    expect(noName.status).toBe(400);
    const badType = await addField(await addReq(id, { detected_name: "x", detected_type: "blob" }), { params: Promise.resolve({ id }) });
    expect(badType.status).toBe(400);
    const badPage = await addField(await addReq(id, { detected_name: "x", page_number: 0 }), { params: Promise.resolve({ id }) });
    expect(badPage.status).toBe(400);
    const badKey = await addField(await addReq(id, { detected_name: "x", final_core_key: "not_a_key" }), { params: Promise.resolve({ id }) });
    expect(badKey.status).toBe(400);

    await prisma.uploaded_forms.update({ where: { id }, data: { status: "rejected" } });
    const wrongState = await addField(await addReq(id, { detected_name: "seller_name" }), { params: Promise.resolve({ id }) });
    expect(wrongState.status).toBe(409);
  });

  it("is admin-only (403)", async () => {
    const { id } = await seedConfirmedForm();
    const res = await addField(
      new Request(`http://localhost/api/admin/forms/${id}/fields`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: await authHeader("auth0|a", ["agent"]) },
        body: JSON.stringify({ detected_name: "seller_name" }),
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(403);
  });
});

describe("admin deletes a bogus field", () => {
  it("removes the box and RE-ARMS the gate", async () => {
    const { id } = await seedConfirmedForm();
    const field = await prisma.uploaded_form_fields.findFirstOrThrow({ where: { form_id: id } });
    const res = await deleteField(await delReq(id, field.id), { params: Promise.resolve({ id, fieldId: field.id }) });
    expect(res.status).toBe(204);
    expect(await prisma.uploaded_form_fields.findUnique({ where: { id: field.id } })).toBeNull();
    const form = await prisma.uploaded_forms.findUniqueOrThrow({ where: { id } });
    expect(form.placement_confirmed_at).toBeNull();
  });

  it("404s an unknown field, 403s a non-admin, 409s a non-pending form", async () => {
    const { id } = await seedConfirmedForm();
    const field = await prisma.uploaded_form_fields.findFirstOrThrow({ where: { form_id: id } });

    const missing = await deleteField(await delReq(id, "00000000-0000-0000-0000-000000000000"), {
      params: Promise.resolve({ id, fieldId: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(missing.status).toBe(404);

    const forbidden = await deleteField(await delReq(id, field.id, authHeader("auth0|a", ["agent"])), {
      params: Promise.resolve({ id, fieldId: field.id }),
    });
    expect(forbidden.status).toBe(403);

    await prisma.uploaded_forms.update({ where: { id }, data: { status: "rejected" } });
    const wrongState = await deleteField(await delReq(id, field.id), { params: Promise.resolve({ id, fieldId: field.id }) });
    expect(wrongState.status).toBe(409);
  });
});
