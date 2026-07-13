import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { PDFDocument } from "pdf-lib";
import { POST as createForm } from "@/app/api/me/forms/route";
import { POST as processJobs } from "@/app/api/jobs/process/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setStorageForTesting, type TestStorage } from "@/lib/blob-storage";
import { setVisionDetectorForTesting, type VisionFieldDetector } from "@/lib/form-ai/vision";
import { seedFormTypes, PURCHASE_AGREEMENT_KEY } from "@/lib/form-types-seed";
import { runFormDetectJob, waitForInlineFormDetects } from "@/lib/form-detect";
import { resetEnvForTesting } from "@/lib/env";
import {
  FORM_DETECT_QUEUE,
  enqueueFormDetectJob,
  getBoss,
  stopBossForTesting,
  processFormDetectJobs,
  type FormDetectJobPayload,
} from "@/lib/queue";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/factories";

let storage: TestStorage;
let FLAT2: Uint8Array;

const TEST_CRON_SECRET = "test-cron-secret";

// Canned "located" fields — real detector replaced; labels MUST exist in the type
// field set. Like the real detectGuided, this returns located fields for EVERY page
// present in the expected set (the job hands it the whole query in one call).
const CANNED = [
  { label: "buyer_name", type: "text", page: 1, rect: { x: 72, y: 700, width: 200, height: 18 } },
  { label: "purchase_price", type: "text", page: 1, rect: { x: 400, y: 600, width: 80, height: 18 } },
  { label: "buyer1_signature", type: "signature", page: 2, rect: { x: 72, y: 120, width: 200, height: 24 } },
];

// The fake detector is stateful so tests can watch and steer the INLINE detect
// path (#193): `detectCalls` counts vision runs (double-processing shows up
// here), `failDetect` makes a run throw (the inline-failure path), and `gate`
// holds a run open so the intermediate 'detecting' state is observable without
// racing the fire-and-forget inline attempt.
let detectCalls = 0;
let failDetect = false;
let gate: { opened: Promise<void>; open: () => void } | null = null;

function holdDetector() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  gate = { opened, open };
  return gate;
}

const fakeDetector: VisionFieldDetector = {
  detect: async () => [],
  detectGuided: async ({ expected }) => {
    detectCalls += 1;
    if (gate) await gate.opened;
    if (failDetect) throw new Error("vision exploded (test)");
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
  process.env.CRON_SECRET = TEST_CRON_SECRET; // the sweep-drain tests hit /api/jobs/process
  resetEnvForTesting();
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.addPage([612, 792]);
  FLAT2 = await doc.save();
  await getBoss(); // ensure the form-detect queue exists before enqueue
});

afterAll(async () => {
  await stopBossForTesting();
  delete process.env.CRON_SECRET;
  resetEnvForTesting();
});

beforeEach(async () => {
  await truncateAll();
  // Queue isolation: pgboss.* lives outside truncateAll's table list, so purge
  // leftover detect jobs — job counts below must be this test's own.
  await (await getBoss()).deleteAllJobs(FORM_DETECT_QUEUE);
  storage = setStorageForTesting()!;
  storage.defaultBytes = FLAT2;
  storage.defaultSize = 4096;
  detectCalls = 0;
  failDetect = false;
  gate = null;
  setVisionDetectorForTesting(fakeDetector);
  await seedFormTypes();
});

afterEach(async () => {
  // Let any straggling inline attempt finish against the FAKE detector before
  // it's uninstalled (a straggler with no injected detector would build the
  // real vision client).
  gate?.open();
  await waitForInlineFormDetects();
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

/** Jobs the cron sweep could still pick up (created / retry) for one form. */
async function runnableDetectJobs(formId: string) {
  const boss = await getBoss();
  const jobs = await boss.findJobs<FormDetectJobPayload>(FORM_DETECT_QUEUE);
  return jobs.filter(
    (j) => (j.state === "created" || j.state === "retry") && j.data?.formId === formId
  );
}

describe("guided-vision detect job (Phase 3, pt 2b)", () => {
  it("flat + typed + unrecognized upload → 'detecting' while vision runs (no fields yet)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await onboard(agent.id);
    holdDetector(); // hold the inline vision run open so 'detecting' is observable
    const res = await uploadFlat(agent.id);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string; field_count: number };
    expect(body.status).toBe("detecting");
    expect(body.field_count).toBe(0);

    const form = await prisma.uploaded_forms.findUniqueOrThrow({ where: { id: body.id } });
    expect(form.status).toBe("detecting");
    expect(form.detection_source).toBe("vision");
    expect(form.form_type_id).not.toBeNull();
    expect(await prisma.uploaded_form_fields.count({ where: { form_id: body.id } })).toBe(0);
  });

  it("detection runs INLINE on upload — fields land without any cron sweep (#193)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await onboard(agent.id);
    const res = await uploadFlat(agent.id);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    // Settle the fire-and-forget inline attempt. NO sweep runs in this test.
    await waitForInlineFormDetects();

    const form = await prisma.uploaded_forms.findUniqueOrThrow({ where: { id } });
    expect(form.status).toBe("pending_review");
    expect(form.detection_source).toBe("vision"); // still gated by the overlay
    expect(detectCalls).toBe(1);

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

    // Inline success CONSUMED the durable job — the daily sweep won't refetch it.
    expect(await runnableDetectJobs(id)).toHaveLength(0);
  });

  it("the 'detecting' guard keeps the sweep from double-running an inline-completed form (#193)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await onboard(agent.id);
    const { id } = (await (await uploadFlat(agent.id)).json()) as { id: string };
    await waitForInlineFormDetects();
    expect(detectCalls).toBe(1);
    const before = (
      await prisma.uploaded_form_fields.findMany({ where: { form_id: id }, select: { id: true } })
    )
      .map((f) => f.id)
      .sort();
    expect(before).toHaveLength(3);

    // Lost race: the sweep fetched the job before the inline attempt could
    // consume it. Simulate with a duplicate durable job → the sweep runs it →
    // runFormDetectJob's idempotent 'detecting' guard no-ops.
    await enqueueFormDetectJob(id);
    const r = await processFormDetectJobs({ limit: 5 });
    expect(r.failed).toBe(0);

    expect(detectCalls).toBe(1); // vision did NOT run again
    const after = (
      await prisma.uploaded_form_fields.findMany({ where: { form_id: id }, select: { id: true } })
    )
      .map((f) => f.id)
      .sort();
    expect(after).toEqual(before); // rows untouched, not rewritten
    const form = await prisma.uploaded_forms.findUniqueOrThrow({ where: { id } });
    expect(form.status).toBe("pending_review");
  });

  it("an inline failure leaves the durable job for the cron sweep (#193)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await onboard(agent.id);
    failDetect = true;
    const res = await uploadFlat(agent.id);
    expect(res.status).toBe(201); // a vision failure must never fail the upload
    const { id } = (await res.json()) as { id: string };
    await waitForInlineFormDetects();

    let form = await prisma.uploaded_forms.findUniqueOrThrow({ where: { id } });
    expect(form.status).toBe("detecting"); // untouched — the sweep will retry
    expect(detectCalls).toBe(1); // inline DID attempt
    expect(await runnableDetectJobs(id)).toHaveLength(1); // job NOT consumed

    failDetect = false; // vision recovers before the sweep fires
    const r = await processFormDetectJobs({ limit: 5 });
    expect(r.processed).toBeGreaterThanOrEqual(1);
    form = await prisma.uploaded_forms.findUniqueOrThrow({ where: { id } });
    expect(form.status).toBe("pending_review");
    expect(await prisma.uploaded_form_fields.count({ where: { form_id: id } })).toBe(3);
    expect(detectCalls).toBe(2);
  });

  it("is idempotent — re-processing a finished form writes nothing new", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await onboard(agent.id);
    const { id } = (await (await uploadFlat(agent.id)).json()) as { id: string };
    await waitForInlineFormDetects();
    // a stray re-run of the job is a no-op (status is no longer 'detecting')
    await runFormDetectJob(id);
    expect(await prisma.uploaded_form_fields.count({ where: { form_id: id } })).toBe(3);
    expect(detectCalls).toBe(1);
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

// ── the cron sweep drains a BACKLOG (#193) ──────────────────────────────────
//
// On the Hobby plan the sweep fires once a DAY, so the old fixed 3-job batch
// let a backlog grow faster than it drained. The route now keeps pulling due
// jobs until the queue is empty (or its time budget is spent).
describe("POST /api/jobs/process — form-detect backlog drain (#193)", () => {
  it("one sweep drains more than the old 3-job batch", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await onboard(agent.id);

    // Five stranded 'detecting' forms, each with a queued durable job. No
    // form_type → runFormDetectJob resolves each without a vision call.
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const f = await prisma.uploaded_forms.create({
        data: {
          agent_id: agent.id,
          label: `stranded ${i}`,
          side: "buy",
          source_s3_key: `agent-forms/${agent.id}/1/s${i}.pdf`,
          source_file_name: `s${i}.pdf`,
          attested_by: agent.id,
          attestation_statement: "a",
          file_sha256: `sha-${i}`,
          status: "detecting",
          detection_source: "vision",
          form_type_id: null,
        },
        select: { id: true },
      });
      ids.push(f.id);
      await enqueueFormDetectJob(f.id);
    }

    const res = await processJobs(
      new Request("http://localhost/api/jobs/process", {
        method: "POST",
        headers: { authorization: `Bearer ${TEST_CRON_SECRET}` },
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { detect: { processed: number; failed: number } };
    expect(body.detect.processed).toBe(5);
    expect(body.detect.failed).toBe(0);

    for (const id of ids) {
      const f = await prisma.uploaded_forms.findUniqueOrThrow({ where: { id } });
      expect(f.status).toBe("pending_review");
    }
  });
});
