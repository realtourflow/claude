import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PDFDocument } from "pdf-lib";
import { POST as action } from "@/app/api/admin/forms/[id]/route";
import { PATCH as patchField } from "@/app/api/admin/forms/[id]/fields/[fieldId]/route";
import { POST as confirmPlacement } from "@/app/api/admin/forms/[id]/confirm-placement/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setStorageForTesting, type TestStorage } from "@/lib/blob-storage";
import { setDocusignForTesting, type DocusignClient } from "@/lib/docusign";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/factories";

let storage: TestStorage;
let PDF: Uint8Array;

const fakeDocusign: DocusignClient = {
  enabled: () => true,
  createEnvelope: async () => "env",
  createTemplateEnvelope: async () => "env",
  getEnvelopeStatus: async () => "sent",
  downloadCombinedDocument: async () => new Uint8Array(),
  listRecipients: async () => [],
  createRecipientView: async () => "https://view",
  createTemplateFromDocument: async () => "tmpl-xyz",
};


beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
  setDocusignForTesting(fakeDocusign);
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  PDF = await doc.save();
});

afterAll(() => setDocusignForTesting(undefined));

beforeEach(async () => {
  await truncateAll();
  storage = setStorageForTesting()!;
  storage.defaultBytes = PDF;
});

const adminHdr = () => authHeader("auth0|admin", ["admin"]);

// A pending form whose single field is fully RESOLVED (needs_review=false) — so the
// ONLY thing standing between it and approval is the placement gate.
async function seedForm(
  agentId: string,
  detectionSource: string,
  opts: { confirmed?: boolean } = {}
): Promise<string> {
  const form = await prisma.uploaded_forms.create({
    data: {
      agent_id: agentId,
      label: "PA",
      side: "buy",
      source_s3_key: `agent-forms/${agentId}/1/pa.pdf`,
      source_file_name: "pa.pdf",
      attested_by: agentId,
      attestation_statement: "I attest.",
      file_sha256: "x",
      status: "pending_review",
      detection_source: detectionSource,
      ...(opts.confirmed
        ? { placement_confirmed_at: new Date(), placement_confirmed_by: agentId }
        : {}),
    },
    select: { id: true },
  });
  await prisma.uploaded_form_fields.create({
    data: {
      form_id: form.id,
      detected_name: "buyer_name",
      detected_type: "text",
      page_number: 1,
      pos_x: 72,
      pos_y: 700,
      width: 200,
      height: 18,
      ai_core_key: "buyer_name",
      ai_role: "Buyer",
      ai_confidence: 1,
      needs_review: false,
      decision: "accepted",
      final_core_key: "buyer_name",
      final_role: "Buyer",
      final_type: "text",
    },
  });
  return form.id;
}

const approveReq = async (id: string) =>
  new Request(`http://localhost/api/admin/forms/${id}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: await adminHdr() },
    body: JSON.stringify({ action: "approve" }),
  });
const confirmReq = async (id: string) =>
  new Request(`http://localhost/api/admin/forms/${id}/confirm-placement`, {
    method: "POST",
    headers: { authorization: await adminHdr() },
  });

describe("mandatory placement gate (vision forms)", () => {
  beforeEach(async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
  });

  it("BLOCKS approval of a vision form until placement is confirmed", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedForm(agent.id, "vision");

    const res = await action(await approveReq(id), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(422);
    expect(await res.text()).toMatch(/placement/i);
    // never reached 'ready'
    expect((await prisma.uploaded_forms.findUniqueOrThrow({ where: { id } })).status).toBe(
      "pending_review"
    );
  });

  it("ALLOWS approval once placement is confirmed", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedForm(agent.id, "vision");

    const c = await confirmPlacement(await confirmReq(id), { params: Promise.resolve({ id }) });
    expect(c.status).toBe(200);
    const form = await prisma.uploaded_forms.findUniqueOrThrow({ where: { id } });
    expect(form.placement_confirmed_at).not.toBeNull();

    const res = await action(await approveReq(id), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ready");
  });

  it("does NOT gate a non-vision (acroform) form — approves without confirmation", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedForm(agent.id, "acroform");

    const res = await action(await approveReq(id), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ready");
  });

  it("dragging a field position CLEARS a prior confirmation (forces re-confirm)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedForm(agent.id, "vision", { confirmed: true });
    const field = await prisma.uploaded_form_fields.findFirstOrThrow({ where: { form_id: id } });

    const patched = await patchField(
      new Request(`http://localhost/api/admin/forms/${id}/fields/${field.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: await adminHdr() },
        body: JSON.stringify({ pos_x: 120, pos_y: 650 }),
      }),
      { params: Promise.resolve({ id, fieldId: field.id }) }
    );
    expect(patched.status).toBe(200);
    const moved = await prisma.uploaded_form_fields.findUniqueOrThrow({ where: { id: field.id } });
    expect(Number(moved.pos_x)).toBe(120);

    const form = await prisma.uploaded_forms.findUniqueOrThrow({ where: { id } });
    expect(form.placement_confirmed_at).toBeNull();

    // and so approval is blocked again
    const res = await action(await approveReq(id), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(422);
  });

  it("rejects a negative drag coordinate (400)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedForm(agent.id, "vision");
    const field = await prisma.uploaded_form_fields.findFirstOrThrow({ where: { form_id: id } });
    const res = await patchField(
      new Request(`http://localhost/api/admin/forms/${id}/fields/${field.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: await adminHdr() },
        body: JSON.stringify({ pos_x: -5 }),
      }),
      { params: Promise.resolve({ id, fieldId: field.id }) }
    );
    expect(res.status).toBe(400);
  });

  it("confirm-placement requires the form to be pending_review", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedForm(agent.id, "vision");
    await prisma.uploaded_forms.update({ where: { id }, data: { status: "rejected" } });
    const res = await confirmPlacement(await confirmReq(id), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(409);
  });
});
