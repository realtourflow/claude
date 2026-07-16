import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { PDFDocument } from "pdf-lib";
import { POST as createForm } from "@/app/api/me/forms/route";
import { POST as processJobs } from "@/app/api/jobs/process/route";
import { GET as adminForms } from "@/app/api/admin/forms/route";
import { POST as retryDetect } from "@/app/api/admin/forms/[id]/retry-detect/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setStorageForTesting, type TestStorage } from "@/lib/blob-storage";
import { setVisionDetectorForTesting, type VisionFieldDetector } from "@/lib/form-ai/vision";
import { seedFormTypes, resolveFormTypeId, PURCHASE_AGREEMENT_KEY } from "@/lib/form-types-seed";
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

// ── #289: a pg-boss enqueue hiccup degrades to inline-only, never data loss ───
//
// The durable job is only the BACKSTOP; inline detection (#193) is the primary
// path and needs no pg-boss. So an enqueue failure at the exact moment of upload
// (transient Neon blip / cold-start race) must NOT throw away the agent's upload
// — it still runs inline and lands in review, just without a durable backstop
// for that one attempt. Before this fix the row + blob were deleted and the
// upload 503'd.
describe("pg-boss enqueue failure degrades to inline-only detection (#289)", () => {
  it("Case 1: an enqueue hiccup keeps the upload, runs inline, deletes neither row nor blob", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await onboard(agent.id);
    const blobKey = `agent-forms/${agent.id}/1/remax-pa.pdf`;

    let formId = "";
    const goodDbUrl = process.env.DATABASE_URL!;
    try {
      // Break the durable queue exactly at enqueue time: stop the started boss,
      // point DATABASE_URL at an unreachable host, and re-read env so getBoss()
      // rebuilds against it → boss.start() fails → enqueueFormDetectJob throws.
      // Prisma's pool is already open against the real DB, so inline detection
      // (below) is unaffected by this swap.
      await stopBossForTesting();
      process.env.DATABASE_URL = "postgres://x:x@127.0.0.1:1/nope?sslmode=disable";
      resetEnvForTesting();

      const res = await uploadFlat(agent.id);
      // Upload SURVIVES the enqueue failure — no 503, no data loss.
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; status: string };
      formId = body.id;
      expect(["detecting", "pending_review"]).toContain(body.status);

      // The row was NOT deleted…
      expect(await prisma.uploaded_forms.findUnique({ where: { id: formId } })).not.toBeNull();
      // …and the blob was NOT deleted.
      expect(storage.deletes).not.toContain(blobKey);
    } finally {
      // Restore BEFORE the next test's beforeEach rebuilds the boss singleton,
      // so a bad URL never poisons a sibling test.
      process.env.DATABASE_URL = goodDbUrl;
      resetEnvForTesting();
    }

    // Inline detection (real DB via Prisma's open pool + the injected fake
    // detector) resolves the form normally — pending_review with its fields.
    await waitForInlineFormDetects();
    const done = await prisma.uploaded_forms.findUniqueOrThrow({ where: { id: formId } });
    expect(done.status).toBe("pending_review");
    expect(await prisma.uploaded_form_fields.count({ where: { form_id: formId } })).toBe(3);
    expect(detectCalls).toBe(1); // inline DID run
  });

  it("Case 2: after the queue recovers, a normal upload still enqueues a durable backstop job", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await onboard(agent.id);

    // Hold the inline run open so the durable job isn't consumed before we can
    // observe it (inline success completes the job).
    holdDetector();
    const res = await uploadFlat(agent.id);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    // The happy path is unaffected: a durable backstop job was enqueued.
    expect(await runnableDetectJobs(id)).toHaveLength(1);

    // Let inline finish → it consumes the job and resolves the form.
    gate!.open();
    await waitForInlineFormDetects();
    const form = await prisma.uploaded_forms.findUniqueOrThrow({ where: { id } });
    expect(form.status).toBe("pending_review");
    expect(await runnableDetectJobs(id)).toHaveLength(0); // inline consumed it
  });

  it("Case 3: a flat upload with NO declared type still 422s (unrelated failure mode unchanged)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await onboard(agent.id);
    const res = await uploadFlat(agent.id, false);
    expect(res.status).toBe(422);
    expect(await prisma.uploaded_forms.count()).toBe(0);
  });
});

// ── #288: guided vision can locate the SAME field on multiple pages ──────────
//
// The job queries EVERY page with the FULL field set (a new layout hides which
// page a field lives on), so vision can re-match one field NAME on more than one
// page. The purchase_agreement type has no field that legitimately recurs across
// pages, so a same-name hit on a second page is a detection error. Dedup by NAME
// keeps the FIRST (in PAGE ORDER) accepted and flags the rest for the admin, so
// no core key ever silently carries two accepted boxes.
describe("guided-vision detect dedupes same-name multi-page hits (#288)", () => {
  type Loc = { name: string; type: string; page: number; rect: { x: number; y: number; width: number; height: number } };

  // A detector returning a fixed located list — filtered to the pages the job
  // actually queries, mirroring the real detectGuided (it only reports pages it
  // was handed). Preserves the given ORDER so a test can emit hits out of page
  // order and prove the job dedupes by page order, not array order.
  function detectorReturning(located: Loc[]): VisionFieldDetector {
    return {
      detect: async () => [],
      detectGuided: async ({ expected }) => {
        const pages = new Set(expected.map((e) => e.page));
        return located
          .filter((c) => pages.has(c.page))
          .map((c) => ({
            name: c.name,
            type: c.type as "text" | "signature",
            page: c.page,
            rect: c.rect,
            nearbyText: c.name,
          }));
      },
    };
  }

  // Create a 'detecting' vision form wired to the purchase_agreement type, then
  // run detection DIRECTLY (no upload/inline path) so the dedup is tested in
  // isolation. FLAT2 (the beforeEach default bytes) is 2 pages → the job queries
  // pages 1-2.
  async function detectWith(located: Loc[]) {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const typeId = await resolveFormTypeId(PURCHASE_AGREEMENT_KEY);
    expect(typeId).not.toBeNull();
    const form = await prisma.uploaded_forms.create({
      data: {
        agent_id: agent.id,
        label: "dup-test",
        side: "buy",
        source_s3_key: `agent-forms/${agent.id}/1/dup.pdf`,
        source_file_name: "dup.pdf",
        attested_by: agent.id,
        attestation_statement: "a",
        file_sha256: "dup-sha",
        status: "detecting",
        detection_source: "vision",
        form_type_id: typeId,
      },
      select: { id: true },
    });
    setVisionDetectorForTesting(detectorReturning(located));
    await runFormDetectJob(form.id);
    return prisma.uploaded_form_fields.findMany({
      where: { form_id: form.id },
      orderBy: [{ detected_name: "asc" }, { page_number: "asc" }],
    });
  }

  it("Case 1: same field on TWO pages → first in PAGE ORDER accepted, second needs_review/pending", async () => {
    // Emit the page-2 hit FIRST to prove dedup is by PAGE ORDER, not array order:
    // the page-1 box must still win as the single accepted one.
    const fields = await detectWith([
      { name: "buyer1_signature", type: "signature", page: 2, rect: { x: 72, y: 120, width: 200, height: 24 } },
      { name: "buyer1_signature", type: "signature", page: 1, rect: { x: 72, y: 500, width: 200, height: 24 } },
    ]);
    const sigs = fields.filter((f) => f.detected_name === "buyer1_signature");
    expect(sigs).toHaveLength(2); // BOTH rows written — no data dropped

    const accepted = sigs.filter((f) => f.decision === "accepted");
    const flagged = sigs.filter((f) => f.decision === "pending");
    expect(accepted).toHaveLength(1); // exactly ONE accepted (fails today: both accepted)
    expect(flagged).toHaveLength(1);

    expect(accepted[0].page_number).toBe(1); // the FIRST in page order
    expect(accepted[0].needs_review).toBe(false);

    expect(flagged[0].page_number).toBe(2);
    expect(flagged[0].needs_review).toBe(true);
    expect(flagged[0].final_core_key).toBeNull();
    expect(flagged[0].final_role).toBeNull();
    expect(flagged[0].final_type).toBeNull();
  });

  it("Case 1b: a core-key-bearing field duplicated → only ONE accepted box carries the core key", async () => {
    const fields = await detectWith([
      { name: "buyer_name", type: "text", page: 1, rect: { x: 72, y: 700, width: 200, height: 18 } },
      { name: "buyer_name", type: "text", page: 2, rect: { x: 72, y: 700, width: 200, height: 18 } },
    ]);
    const rows = fields.filter((f) => f.detected_name === "buyer_name");
    expect(rows).toHaveLength(2);

    // No core key silently carries more than one accepted box.
    const acceptedWithKey = rows.filter((f) => f.decision === "accepted" && f.final_core_key === "buyer_name");
    expect(acceptedWithKey).toHaveLength(1);
    expect(acceptedWithKey[0].page_number).toBe(1);

    const dup = rows.find((f) => f.decision === "pending")!;
    expect(dup.final_core_key).toBeNull();
    expect(dup.needs_review).toBe(true);
    // The AI's suggestion is still recorded so the admin sees what vision thought.
    expect(dup.ai_core_key).toBe("buyer_name");
  });

  it("Case 2: a field located on exactly ONE page is unaffected (accepted, not needs_review)", async () => {
    const fields = await detectWith([
      { name: "buyer_name", type: "text", page: 1, rect: { x: 72, y: 700, width: 200, height: 18 } },
    ]);
    const rows = fields.filter((f) => f.detected_name === "buyer_name");
    expect(rows).toHaveLength(1);
    expect(rows[0].decision).toBe("accepted");
    expect(rows[0].needs_review).toBe(false);
    expect(rows[0].final_core_key).toBe("buyer_name");
    expect(rows[0].final_role).toBe("Buyer1");
  });

  it("Case 3: two DIFFERENT fields on different pages stay independent + both accepted (dedup by NAME, not page)", async () => {
    const fields = await detectWith([
      { name: "buyer_name", type: "text", page: 1, rect: { x: 72, y: 700, width: 200, height: 18 } },
      { name: "purchase_price", type: "text", page: 2, rect: { x: 400, y: 600, width: 80, height: 18 } },
    ]);
    expect(fields).toHaveLength(2);
    for (const f of fields) {
      expect(f.decision).toBe("accepted");
      expect(f.needs_review).toBe(false);
    }
    const bn = fields.find((f) => f.detected_name === "buyer_name")!;
    const pp = fields.find((f) => f.detected_name === "purchase_price")!;
    expect(bn.final_core_key).toBe("buyer_name");
    expect(pp.final_core_key).toBe("purchase_price");
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

// ── admin visibility + retry for a form stuck in 'detecting' (#284) ──────────
//
// When a detect job exhausts its 3 pg-boss retries it parks in `failed` and
// nothing flips the uploaded_forms row out of 'detecting' — so the form is
// invisible to the admin queue and un-retryable, and the agent sees
// "Detecting…" forever. These lock in: (1) the default pending queue surfaces
// 'detecting' rows with their age, and (2) an admin can re-run detection.
describe("stuck 'detecting' forms — admin queue + retry-detect (#284)", () => {
  // A row stranded in 'detecting' exactly as an exhausted job leaves it (the
  // durable job is gone/failed; only the DB row remains). Typed by default so a
  // retry has a field set to locate.
  async function makeDetecting(agentId: string, withType = true) {
    const formTypeId = withType ? await resolveFormTypeId(PURCHASE_AGREEMENT_KEY) : null;
    return prisma.uploaded_forms.create({
      data: {
        agent_id: agentId,
        label: "Stuck PA",
        side: "buy",
        source_s3_key: `agent-forms/${agentId}/1/stuck.pdf`,
        source_file_name: "stuck.pdf",
        attested_by: agentId,
        attestation_statement: "a",
        file_sha256: `sha-${agentId}-${Math.random()}`,
        status: "detecting",
        detection_source: "vision",
        form_type_id: formTypeId,
      },
      select: { id: true, created_at: true },
    });
  }

  async function adminQueue(status?: string) {
    const q = status ? `?status=${status}` : "";
    return adminForms(
      new Request(`http://localhost/api/admin/forms${q}`, {
        headers: { authorization: await authHeader("auth0|admin", ["admin"]) },
      })
    );
  }

  async function callRetry(formId: string, roles: string[] = ["admin"]) {
    return retryDetect(
      new Request(`http://localhost/api/admin/forms/${formId}/retry-detect`, {
        method: "POST",
        headers: { authorization: await authHeader("auth0|admin", roles) },
      }),
      { params: Promise.resolve({ id: formId }) }
    );
  }

  // Case 1 (fails today): the default pending queue must include the stranded
  // 'detecting' row, exposing created_at so the UI can badge it stuck.
  it("surfaces a stranded 'detecting' form in the default pending queue with its age", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const form = await makeDetecting(agent.id);

    const res = await adminQueue(); // default filter = pending
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ id: string; status: string; created_at: string }>;
    const row = rows.find((r) => r.id === form.id);
    expect(row).toBeDefined();
    expect(row!.status).toBe("detecting");
    // created_at drives the "> 1h = stuck" badge in the UI.
    expect(typeof row!.created_at).toBe("string");
    expect(Number.isNaN(Date.parse(row!.created_at))).toBe(false);
  });

  // Case 2: admin retry re-enqueues + kicks the inline detect (fake detector),
  // so detection runs end-to-end → pending_review with fields. No real vision.
  it("admin retry re-runs detection end-to-end → pending_review with fields", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const form = await makeDetecting(agent.id);

    const res = await callRetry(form.id);
    expect(res.status).toBe(200);

    await waitForInlineFormDetects();
    expect(detectCalls).toBe(1); // the injected fake ran; no real vision/Anthropic

    const after = await prisma.uploaded_forms.findUniqueOrThrow({ where: { id: form.id } });
    expect(after.status).toBe("pending_review");
    expect(await prisma.uploaded_form_fields.count({ where: { form_id: form.id } })).toBe(3);
  });

  // Case 3: retry is a no-op on a non-'detecting' form (409) and is admin-gated (403).
  it("409 on a non-'detecting' form; 403 for a non-admin — neither kicks detection", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });

    // A form past detection can't be retried.
    const ready = await prisma.uploaded_forms.create({
      data: {
        agent_id: agent.id,
        label: "already reviewed",
        side: "buy",
        source_s3_key: `agent-forms/${agent.id}/1/r.pdf`,
        source_file_name: "r.pdf",
        attested_by: agent.id,
        attestation_statement: "a",
        file_sha256: "sha-ready",
        status: "pending_review",
        detection_source: "vision",
      },
      select: { id: true },
    });
    expect((await callRetry(ready.id)).status).toBe(409);

    // Non-admin is rejected even on a genuinely stuck form.
    const stuck = await makeDetecting(agent.id);
    expect((await callRetry(stuck.id, ["agent"])).status).toBe(403);

    expect(detectCalls).toBe(0); // a rejected retry never runs the detector
  });
});
