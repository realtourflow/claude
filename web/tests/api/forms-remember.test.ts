import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { PDFDocument } from "pdf-lib";
import { POST as action } from "@/app/api/admin/forms/[id]/route";
import { POST as confirmPlacement } from "@/app/api/admin/forms/[id]/confirm-placement/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setS3ClientForTesting } from "@/lib/s3";
import { setDocusignForTesting, type DocusignClient } from "@/lib/docusign";
import { seedFormTypes, resolveFormTypeId, PURCHASE_AGREEMENT_KEY } from "@/lib/form-types-seed";
import { matchFlatKnownForm } from "@/lib/known-forms";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/factories";

const s3Mock = mockClient(S3Client);
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
  setDocusignForTesting(fakeDocusign);
  const doc = await PDFDocument.create(); // flat (no AcroForm fields)
  doc.addPage([612, 792]);
  FLAT = await doc.save();
});

afterAll(() => setDocusignForTesting(undefined));

beforeEach(async () => {
  await truncateAll();
  s3Mock.reset();
  s3Mock.on(PutObjectCommand).resolves({});
  s3Mock.on(DeleteObjectCommand).resolves({});
  s3Mock.on(GetObjectCommand).resolves({ Body: bodyOf(FLAT) });
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
