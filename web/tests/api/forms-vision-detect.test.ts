import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { PDFDocument } from "pdf-lib";
import { POST as createForm } from "@/app/api/me/forms/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setStorageForTesting, type TestStorage } from "@/lib/blob-storage";
import { setVisionDetectorForTesting, type VisionFieldDetector } from "@/lib/form-ai/vision";
import { seedFormTypes, PURCHASE_AGREEMENT_KEY } from "@/lib/form-types-seed";
import { runFormDetectJob } from "@/lib/form-detect";
import { getBoss, stopBossForTesting, processFormDetectJobs } from "@/lib/queue";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/factories";

let storage: TestStorage;
let FLAT2: Uint8Array;

// Canned "located" fields — real detector replaced; labels MUST exist in the type
// field set. Like the real detectGuided, this returns located fields for EVERY page
// present in the expected set (the job hands it the whole query in one call).
const CANNED = [
  { label: "buyer_name", type: "text", page: 1, rect: { x: 72, y: 700, width: 200, height: 18 } },
  { label: "purchase_price", type: "text", page: 1, rect: { x: 400, y: 600, width: 80, height: 18 } },
  { label: "buyer1_signature", type: "signature", page: 2, rect: { x: 72, y: 120, width: 200, height: 24 } },
];
const fakeDetector: VisionFieldDetector = {
  detect: async () => [],
  detectGuided: async ({ expected }) => {
    const pages = new Set(expected.map((e) => e.page));
    return CANNED.filter((c) => pages.has(c.page)).map((c) => ({
      name: c.label,
      type: c.type as "text" | "signature",
      page: c.page,
      rect: c.rect,
      nearbyText: c.label,
    }));
  },
};


beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.addPage([612, 792]);
  FLAT2 = await doc.save();
  await getBoss(); // ensure the form-detect queue exists before enqueue
});

afterAll(async () => {
  await stopBossForTesting();
});

beforeEach(async () => {
  await truncateAll();
  storage = setStorageForTesting()!;
  storage.defaultBytes = FLAT2;
  storage.defaultSize = 4096;
  setVisionDetectorForTesting(fakeDetector);
  await seedFormTypes();
});

afterEach(() => {
  setVisionDetectorForTesting(undefined);
});

// Uploading requires a declared company + market (the profile gate).
async function onboard(agentId: string) {
  await prisma.users.update({
    where: { id: agentId },
    data: { brokerage: "ARC Realty", market: "BIRMINGHAM_AAR", markets: ["BIRMINGHAM_AAR"] },
  });
}

async function uploadFlat(agentId: string, withType = true) {
  return createForm(
    new Request("http://localhost/api/me/forms", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: await authHeader("auth0|a", ["agent"]) },
      body: JSON.stringify({
        label: "RE/MAX PA",
        side: "buy",
        file_name: "remax-pa.pdf",
        s3_key: `agent-forms/${agentId}/1/remax-pa.pdf`,
        mime_type: "application/pdf",
        attestation: true,
        ...(withType ? { form_type: PURCHASE_AGREEMENT_KEY } : {}),
      }),
    })
  );
}

describe("guided-vision detect job (Phase 3, pt 2b)", () => {
  it("flat + typed + unrecognized upload → 'detecting' (no fields yet)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await onboard(agent.id);
    const res = await uploadFlat(agent.id);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string; field_count: number };
    expect(body.status).toBe("detecting");
    expect(body.field_count).toBe(0);

    const form = await prisma.uploaded_forms.findUniqueOrThrow({ where: { id: body.id } });
    expect(form.detection_source).toBe("vision");
    expect(form.form_type_id).not.toBeNull();
    expect(await prisma.uploaded_form_fields.count({ where: { form_id: body.id } })).toBe(0);
  });

  it("the background job locates fields, maps them from the type, and flips to pending_review", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await onboard(agent.id);
    const { id } = (await (await uploadFlat(agent.id)).json()) as { id: string };

    // (>=1: the pgboss queue persists across tests, so a prior test's orphan job
    // — whose form was truncated — may be drained alongside this one. This form's
    // own outcome is the real assertion.)
    const result = await processFormDetectJobs({ limit: 5 });
    expect(result.processed).toBeGreaterThanOrEqual(1);

    const form = await prisma.uploaded_forms.findUniqueOrThrow({ where: { id } });
    expect(form.status).toBe("pending_review");
    expect(form.detection_source).toBe("vision"); // still gated by the overlay

    const fields = await prisma.uploaded_form_fields.findMany({ where: { form_id: id }, orderBy: { page_number: "asc" } });
    expect(fields).toHaveLength(3);

    const buyer = fields.find((f) => f.detected_name === "buyer_name")!;
    expect(buyer.ai_core_key).toBe("buyer_name"); // mapping from the TYPE, not a guess
    expect(buyer.decision).toBe("accepted");
    expect(buyer.needs_review).toBe(false); // mapping resolved; only PLACEMENT gates
    expect(Number(buyer.pos_x)).toBe(72);
    expect(Number(buyer.pos_y)).toBe(700);
    // a field with no core key (signature) is still placed for review
    const sig = fields.find((f) => f.detected_name === "buyer1_signature")!;
    expect(sig.page_number).toBe(2);
  });

  it("is idempotent — re-processing a finished form writes nothing new", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await onboard(agent.id);
    const { id } = (await (await uploadFlat(agent.id)).json()) as { id: string };
    await processFormDetectJobs({ limit: 5 });
    // a stray re-run of the job is a no-op (status is no longer 'detecting')
    await runFormDetectJob(id);
    expect(await prisma.uploaded_form_fields.count({ where: { form_id: id } })).toBe(3);
  });

  it("a 'detecting' form with no type doesn't strand — flips to pending_review empty", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await onboard(agent.id);
    const form = await prisma.uploaded_forms.create({
      data: {
        agent_id: agent.id,
        label: "x",
        side: "buy",
        source_s3_key: `agent-forms/${agent.id}/1/x.pdf`,
        source_file_name: "x.pdf",
        attested_by: agent.id,
        attestation_statement: "a",
        file_sha256: "x",
        status: "detecting",
        detection_source: "vision",
        form_type_id: null,
      },
      select: { id: true },
    });
    await runFormDetectJob(form.id);
    const after = await prisma.uploaded_forms.findUniqueOrThrow({ where: { id: form.id } });
    expect(after.status).toBe("pending_review");
    expect(await prisma.uploaded_form_fields.count({ where: { form_id: form.id } })).toBe(0);
  });

  it("rejects a flat upload with NO declared type (can't guide vision)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await onboard(agent.id);
    const res = await uploadFlat(agent.id, false);
    expect(res.status).toBe(422);
    expect(await prisma.uploaded_forms.count()).toBe(0);
  });
});
