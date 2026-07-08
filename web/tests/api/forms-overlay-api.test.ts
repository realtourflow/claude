import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { PDFDocument } from "pdf-lib";
import { GET as pageImage } from "@/app/api/admin/forms/[id]/page-image/route";
import { GET as formDetail } from "@/app/api/admin/forms/[id]/route";
import { POST as nudgePage } from "@/app/api/admin/forms/[id]/nudge-page/route";
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

const nudgeReq = async (id: string, body: object) =>
  new Request(`http://localhost/api/admin/forms/${id}/nudge-page`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: await adminHdr() },
    body: JSON.stringify(body),
  });

describe("per-page nudge (Phase 3, pt 3)", () => {
  beforeEach(async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
  });

  it("shifts every box on the page up, leaves other pages, and clears confirmation", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedVisionForm(agent.id); // 2 fields on page 1 (pos_y 700, 600)
    await prisma.uploaded_form_fields.create({
      data: { form_id: id, detected_name: "closing_date", detected_type: "text", page_number: 2, pos_x: 80, pos_y: 300, width: 100, height: 18, needs_review: false, decision: "accepted" },
    });
    await prisma.uploaded_forms.update({
      where: { id },
      data: { placement_confirmed_at: new Date(), placement_confirmed_by: agent.id },
    });

    const res = await nudgePage(await nudgeReq(id, { page: 1, dy: 10 }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(2);

    const fields = await prisma.uploaded_form_fields.findMany({ where: { form_id: id } });
    expect(fields.filter((f) => f.page_number === 1).map((f) => Number(f.pos_y)).sort((a, b) => a - b)).toEqual([610, 710]);
    expect(Number(fields.find((f) => f.page_number === 2)!.pos_y)).toBe(300); // untouched

    const form = await prisma.uploaded_forms.findUniqueOrThrow({ where: { id } });
    expect(form.placement_confirmed_at).toBeNull(); // re-armed the gate
  });

  it("clamps a downward shift so pos_y never goes negative", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedVisionForm(agent.id);
    // a box near the bottom of the page (small pos_y) so a down-shift would underflow
    await prisma.uploaded_form_fields.create({
      data: { form_id: id, detected_name: "footer", detected_type: "text", page_number: 1, pos_x: 80, pos_y: 30, width: 100, height: 18, needs_review: false, decision: "accepted" },
    });
    const res = await nudgePage(await nudgeReq(id, { page: 1, dy: -150 }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    const ys = (await prisma.uploaded_form_fields.findMany({ where: { form_id: id, page_number: 1 } })).map((f) => Number(f.pos_y));
    expect(Math.min(...ys)).toBe(0); // the footer box clamped, not negative
  });

  it("is admin-only (403)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedVisionForm(agent.id);
    const res = await nudgePage(
      new Request(`http://localhost/api/admin/forms/${id}/nudge-page`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: await authHeader("auth0|a", ["agent"]) },
        body: JSON.stringify({ page: 1, dy: 5 }),
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(403);
  });

  it("rejects an out-of-range dy (400) and a non-pending form (409)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedVisionForm(agent.id);
    const tooBig = await nudgePage(await nudgeReq(id, { page: 1, dy: 9999 }), { params: Promise.resolve({ id }) });
    expect(tooBig.status).toBe(400);

    await prisma.uploaded_forms.update({ where: { id }, data: { status: "rejected" } });
    const wrongState = await nudgePage(await nudgeReq(id, { page: 1, dy: 5 }), { params: Promise.resolve({ id }) });
    expect(wrongState.status).toBe(409);
  });
});
