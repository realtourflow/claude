import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { PDFDocument } from "pdf-lib";
import { POST as action } from "@/app/api/admin/forms/[id]/route";
import { POST as confirmPlacement } from "@/app/api/admin/forms/[id]/confirm-placement/route";
import { POST as saveKnown } from "@/app/api/admin/forms/[id]/known/route";
import { POST as createForm } from "@/app/api/me/forms/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setStorageForTesting, type TestStorage } from "@/lib/blob-storage";
import { setDocusignForTesting, type DocusignClient } from "@/lib/docusign";
import { setVisionDetectorForTesting, type VisionFieldDetector } from "@/lib/form-ai/vision";
import { seedFormTypes, resolveFormTypeId, PURCHASE_AGREEMENT_KEY } from "@/lib/form-types-seed";
import { matchFlatKnownForm } from "@/lib/known-forms";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/factories";

let storage: TestStorage;
let FLAT: Uint8Array;

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
  const doc = await PDFDocument.create(); // flat (no AcroForm fields)
  doc.addPage([612, 792]);
  FLAT = await doc.save();
});

afterAll(() => {
  setDocusignForTesting(undefined);
  setStorageForTesting(false);
});

beforeEach(async () => {
  await truncateAll();
  // Fresh in-memory Blob backend; any key read returns the flat test PDF.
  storage = setStorageForTesting()!;
  storage.defaultBytes = FLAT;
  await seedFormTypes();
});

const adminHdr = () => authHeader("auth0|admin", ["admin"]);
const approveReq = async (id: string) =>
  new Request(`http://localhost/api/admin/forms/${id}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: await adminHdr() },
    body: JSON.stringify({ action: "approve" }),
  });

// A reviewed, placement-confirmed vision form ready to approve.
async function seedVision(agentId: string, board: string, typeId: string | null): Promise<string> {
  const form = await prisma.uploaded_forms.create({
    data: {
      agent_id: agentId,
      label: "RE/MAX PA",
      side: "buy",
      board,
      source_s3_key: `agent-forms/${agentId}/1/pa.pdf`,
      source_file_name: "pa.pdf",
      attested_by: agentId,
      attestation_statement: "a",
      file_sha256: "x",
      status: "pending_review",
      detection_source: "vision",
      form_type_id: typeId,
      placement_confirmed_at: new Date(),
      placement_confirmed_by: agentId,
    },
    select: { id: true },
  });
  await prisma.uploaded_form_fields.create({
    data: {
      form_id: form.id, detected_name: "buyer_name", detected_type: "text", page_number: 1,
      pos_x: 72, pos_y: 700, width: 200, height: 18,
      ai_core_key: "buyer_name", ai_role: "Buyer", ai_confidence: 1, needs_review: false,
      decision: "accepted", final_core_key: "buyer_name", final_role: "Buyer", final_type: "text",
    },
  });
  return form.id;
}

describe("remember a reviewed vision form (Phase 4)", () => {
  beforeEach(async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
  });

  it("approving a vision form remembers it as a known layout (flat fingerprint + text-minhash + type link), scoped to the agent's market", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const typeId = await resolveFormTypeId(PURCHASE_AGREEMENT_KEY);
    const id = await seedVision(agent.id, "BIRMINGHAM_AAR", typeId);

    const res = await action(await approveReq(id), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);

    const known = await prisma.known_forms.findFirstOrThrow({ where: { source_form_id: id } });
    expect(known.fingerprint).toMatch(/^flat:[0-9a-f]{64}$/); // content hash, not v1: structure
    expect(known.board).toBe("BIRMINGHAM_AAR"); // market scope, NOT universal ('')
    expect(known.type_id).toBe(typeId);
    expect(Array.isArray(known.text_minhash)).toBe(true); // re-saved copies recognize too
    // the REVIEWED placement is snapshotted
    const fields = known.fields as Array<{ detected_name: string; pos_x: number; core_key: string | null }>;
    const buyer = fields.find((f) => f.detected_name === "buyer_name")!;
    expect(buyer.pos_x).toBe(72);
    expect(buyer.core_key).toBe("buyer_name");
  });

  it("the next agent's identical upload is recognized (skips vision) — and only within that market", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const typeId = await resolveFormTypeId(PURCHASE_AGREEMENT_KEY);
    const id = await seedVision(agent.id, "BIRMINGHAM_AAR", typeId);
    await action(await approveReq(id), { params: Promise.resolve({ id }) });

    // recognition on a future upload of the same bytes, same market → match
    expect((await matchFlatKnownForm({ bytes: FLAT, market: "BIRMINGHAM_AAR" })).known).not.toBeNull();
    // a different market doesn't see it (scope), and only this exact form matches
    expect((await matchFlatKnownForm({ bytes: FLAT, market: "BALDWIN_GULF_COAST" })).known).toBeNull();
    expect((await matchFlatKnownForm({ bytes: new Uint8Array([1, 2, 3]), market: "BIRMINGHAM_AAR" })).known).toBeNull();
  });

  it("a standard_board_form type is remembered universally (board = '')", async () => {
    await prisma.form_types.update({ where: { key: PURCHASE_AGREEMENT_KEY }, data: { standard_board_form: true } });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const typeId = await resolveFormTypeId(PURCHASE_AGREEMENT_KEY);
    const id = await seedVision(agent.id, "BIRMINGHAM_AAR", typeId);

    await action(await approveReq(id), { params: Promise.resolve({ id }) });
    const known = await prisma.known_forms.findFirstOrThrow({ where: { source_form_id: id } });
    expect(known.board).toBe(""); // board-wide / universal
  });

  it("remember failure never blocks approval (already-remembered is swallowed)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const typeId = await resolveFormTypeId(PURCHASE_AGREEMENT_KEY);
    const id = await seedVision(agent.id, "BIRMINGHAM_AAR", typeId);
    await action(await approveReq(id), { params: Promise.resolve({ id }) }); // first: remembers

    // force it back to pending and re-approve → the remember hook hits a conflict
    // (already cataloged) which must be swallowed, leaving approval successful.
    await prisma.uploaded_forms.update({ where: { id }, data: { status: "pending_review", docusign_template_id: null } });
    const res = await action(await approveReq(id), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ready");
    // still exactly one catalog entry for this form
    expect(await prisma.known_forms.count({ where: { source_form_id: id } })).toBe(1);
  });

  it("GATE ANSWER (max-safety): a recognized form REQUIRES placement confirmation before approve — every new agent re-confirms", async () => {
    // A recognized upload has detection_source='recognized' — its positions were
    // verified by a PRIOR reviewer and applied to this agent's copy. Max-safety:
    // THIS reviewer must re-confirm placement in the overlay before approval, so a
    // first-review mistake can't propagate silently onto a contract.
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const form = await prisma.uploaded_forms.create({
      data: {
        agent_id: agent.id, label: "PA", side: "buy", board: "BIRMINGHAM_AAR",
        source_s3_key: `agent-forms/${agent.id}/2/pa.pdf`, source_file_name: "pa.pdf",
        attested_by: agent.id, attestation_statement: "a", file_sha256: "y",
        status: "pending_review", detection_source: "recognized",
        placement_confirmed_at: null, // NOT confirmed
      },
      select: { id: true },
    });
    await prisma.uploaded_form_fields.create({
      data: {
        form_id: form.id, detected_name: "buyer_name", detected_type: "text", page_number: 1,
        pos_x: 72, pos_y: 700, width: 200, height: 18,
        ai_core_key: "buyer_name", ai_role: "Buyer", needs_review: false,
        decision: "accepted", final_core_key: "buyer_name", final_role: "Buyer", final_type: "text",
      },
    });

    // unconfirmed → BLOCKED (same as a vision form, not auto-approved)
    const blocked = await action(await approveReq(form.id), { params: Promise.resolve({ id: form.id }) });
    expect(blocked.status).toBe(422);
    expect(await blocked.text()).toMatch(/placement/i);
    expect((await prisma.uploaded_forms.findUniqueOrThrow({ where: { id: form.id } })).status).toBe(
      "pending_review"
    );

    // confirm placement → now it approves
    const confirmRes = await confirmPlacement(
      new Request(`http://localhost/api/admin/forms/${form.id}/confirm-placement`, {
        method: "POST",
        headers: { authorization: await adminHdr() },
      }),
      { params: Promise.resolve({ id: form.id }) }
    );
    expect(confirmRes.status).toBe(200);
    const ok = await action(await approveReq(form.id), { params: Promise.resolve({ id: form.id }) });
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// Issue #286 — admin "save as known" (POST /admin/forms/:id/known) must write a
// RECOGNIZABLE catalog entry for FLAT (vision) forms. Before the fix it always
// recomputed an empty-AcroForm STRUCTURE fingerprint (which the flat/text-layout
// matchers never consult) with a NULL text_minhash and field_count 0, so a saved
// flat form could never be recognized AND every flat form of the same page count
// collided on the same empty-structure fingerprint (spurious 409). The catalog
// entry must carry a flat: content hash + text-layout MinHash + the snapshot field
// count + the document-type link. The FILLABLE (AcroForm) path stays unchanged.
// ---------------------------------------------------------------------------
describe("save-as-known writes a recognizable entry for FLAT forms (#286)", () => {
  let FILLABLE: Uint8Array;
  let FLAT_B: Uint8Array;
  let visionCalls: number;

  // A detector that flags if it is ever invoked — a recognized upload must never
  // reach vision.
  const flagVision: VisionFieldDetector = {
    detect: async () => {
      visionCalls++;
      return [];
    },
    detectGuided: async () => {
      visionCalls++;
      return [];
    },
  };

  beforeAll(async () => {
    // A genuinely FILLABLE PDF (one AcroForm text field) → the structure-fingerprint
    // branch that must remain byte-for-byte unchanged.
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    doc.getForm().createTextField("buyer_name").addToPage(page, {
      x: 72,
      y: 700,
      width: 200,
      height: 18,
    });
    FILLABLE = await doc.save();
    // A SECOND, DISTINCT flat blank with the SAME 1-page count as FLAT — its content
    // hash differs, so the two must not collide in the catalog.
    const doc2 = await PDFDocument.create();
    doc2.addPage([612, 792]);
    doc2.setTitle("a different blank form"); // perturb the bytes → a different hash
    FLAT_B = await doc2.save();
  });

  beforeEach(async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    visionCalls = 0;
    setVisionDetectorForTesting(flagVision);
  });
  afterEach(() => setVisionDetectorForTesting(undefined));

  const knownReq = async (id: string) =>
    new Request(`http://localhost/api/admin/forms/${id}/known`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: await adminHdr() },
      body: "{}",
    });

  // Seed an APPROVED (ready) form with one resolved field + a document-type link.
  // The known route reads status='ready' and snapshots the fields; bytes come from
  // storage at that `key`.
  async function seedReadyForm(
    agentId: string,
    board: string,
    typeId: string | null,
    key: string
  ): Promise<string> {
    const form = await prisma.uploaded_forms.create({
      data: {
        agent_id: agentId,
        label: "RE/MAX PA",
        side: "buy",
        board,
        source_s3_key: key,
        source_file_name: "pa.pdf",
        attested_by: agentId,
        attestation_statement: "a",
        file_sha256: "x",
        status: "ready",
        detection_source: "vision",
        form_type_id: typeId,
        role_mapping: { buyer: "Buyer1" },
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

  it("Case 1: flat save-as-known → flat: fingerprint, ARRAY text_minhash, snapshot field_count, type link", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const typeId = await resolveFormTypeId(PURCHASE_AGREEMENT_KEY);
    const id = await seedReadyForm(agent.id, "BIRMINGHAM_AAR", typeId, `agent-forms/${agent.id}/1/pa.pdf`);

    const res = await saveKnown(await knownReq(id), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      known_form_id: string;
      fingerprint: string;
      field_count: number;
    };
    // content hash the flat matcher consults — NOT the v1: empty-structure hash
    expect(body.fingerprint).toMatch(/^flat:[0-9a-f]{64}$/);
    expect(body.field_count).toBe(1); // the snapshot rows' count, not the structure fp's 0

    const kf = await prisma.known_forms.findUniqueOrThrow({ where: { id: body.known_form_id } });
    expect(kf.fingerprint).toMatch(/^flat:[0-9a-f]{64}$/);
    expect(Array.isArray(kf.text_minhash)).toBe(true); // re-saved same-layout copies match too
    expect(kf.field_count).toBe(1);
    expect(kf.type_id).toBe(typeId); // recognized re-uploads keep their type link
  });

  it("Case 2: the same blank re-uploaded through /me/forms auto-recognizes; vision is never invoked", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const typeId = await resolveFormTypeId(PURCHASE_AGREEMENT_KEY);
    const id = await seedReadyForm(agent.id, "BIRMINGHAM_AAR", typeId, `agent-forms/${agent.id}/1/pa.pdf`);
    const savedRes = await saveKnown(await knownReq(id), { params: Promise.resolve({ id }) });
    expect(savedRes.status).toBe(201);
    const { known_form_id } = (await savedRes.json()) as { known_form_id: string };

    // The agent needs a declared company + market (the upload gate); market == the
    // known form's board so recognition can see the catalog entry.
    await prisma.users.update({
      where: { id: agent.id },
      data: { brokerage: "RE/MAX", market: "BIRMINGHAM_AAR", markets: ["BIRMINGHAM_AAR"] },
    });

    // Upload the SAME bytes (default storage returns FLAT for any key) at a new key.
    const res = await createForm(
      new Request("http://localhost/api/me/forms", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        body: JSON.stringify({
          label: "RE/MAX PA",
          side: "buy",
          file_name: "pa.pdf",
          s3_key: `agent-forms/${agent.id}/2/pa.pdf`,
          mime_type: "application/pdf",
          attestation: true,
          form_type: PURCHASE_AGREEMENT_KEY,
        }),
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string };
    expect(body.status).not.toBe("detecting"); // recognized, not routed to vision

    const form = await prisma.uploaded_forms.findUniqueOrThrow({ where: { id: body.id } });
    expect(form.detection_source).toBe("recognized");
    expect(form.recognized_from_known_form_id).toBe(known_form_id);

    // the catalog answer key was copied onto the new upload
    const fields = await prisma.uploaded_form_fields.findMany({ where: { form_id: body.id } });
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.find((f) => f.detected_name === "buyer_name")?.final_core_key).toBe("buyer_name");

    // the vision detector was NEVER called
    expect(visionCalls).toBe(0);
  });

  it("Case 3a: FILLABLE (AcroForm) save-as-known is unchanged — v1: structure fingerprint, no minhash", async () => {
    storage.defaultBytes = FILLABLE; // this form's bytes carry a real AcroForm field
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const typeId = await resolveFormTypeId(PURCHASE_AGREEMENT_KEY);
    const id = await seedReadyForm(agent.id, "BIRMINGHAM_AAR", typeId, `agent-forms/${agent.id}/1/fill.pdf`);

    const res = await saveKnown(await knownReq(id), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      known_form_id: string;
      fingerprint: string;
      field_count: number;
    };
    expect(body.fingerprint).toMatch(/^v1:[0-9a-f]{64}$/); // structure-fingerprint path unchanged
    expect(body.field_count).toBeGreaterThan(0); // AcroForm field count, not 0

    const kf = await prisma.known_forms.findUniqueOrThrow({ where: { id: body.known_form_id } });
    expect(kf.text_minhash).toBeNull(); // fillable path computes no text minhash
    expect(kf.type_id).toBe(typeId); // the type link is threaded on this branch too
  });

  it("Case 3b: two DISTINCT flat forms of equal page count both save — no spurious 409 collision", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const typeId = await resolveFormTypeId(PURCHASE_AGREEMENT_KEY);
    // Two different 1-page blanks at their own keys with DISTINCT bytes.
    const keyA = `agent-forms/${agent.id}/A/a.pdf`;
    const keyB = `agent-forms/${agent.id}/B/b.pdf`;
    storage.seed(keyA, FLAT); // the shared 1-page blank
    storage.seed(keyB, FLAT_B); // a DIFFERENT 1-page blank
    const idA = await seedReadyForm(agent.id, "BIRMINGHAM_AAR", typeId, keyA);
    const idB = await seedReadyForm(agent.id, "BIRMINGHAM_AAR", typeId, keyB);

    const resA = await saveKnown(await knownReq(idA), { params: Promise.resolve({ id: idA }) });
    const resB = await saveKnown(await knownReq(idB), { params: Promise.resolve({ id: idB }) });
    // Pre-fix both hashed to the SAME empty-structure fingerprint → the second 409'd.
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    const a = (await resA.json()) as { fingerprint: string };
    const b = (await resB.json()) as { fingerprint: string };
    expect(a.fingerprint).not.toBe(b.fingerprint); // distinct content hashes
    expect(await prisma.known_forms.count()).toBe(2);
  });
});
