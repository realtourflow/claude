/**
 * Guided-vision detect job (Phase 3). For a FLAT upload the agent declared a type
 * for but we don't recognize, this LOCATES the type's position-free field set on
 * the agent's specific layout and writes uploaded_form_fields. Runs in the pg-boss
 * background queue (a dense form is ~14 vision calls — too slow for the upload
 * request). The form sits in 'detecting' until this flips it to 'pending_review',
 * where the MANDATORY overlay placement review gates it (detection_source='vision').
 *
 * Mapping comes from the TYPE (buyer_name→buyer_name, etc.) — pre-resolved, so the
 * human's only required job is verifying POSITION in the overlay. Vision LOCATES;
 * the type MAPS.
 */
import { after } from "next/server";
import { PDFDocument } from "pdf-lib";
import { prisma } from "./db";
import { FORM_DETECT_QUEUE, getBoss } from "./queue";
import { getObjectBytes } from "./s3";
import {
  ClaudeVisionDetector,
  getInjectedVisionDetector,
  VISION_CALIBRATE_Y,
  type ExpectedField,
  type PageRenderer,
  type VisionFieldDetector,
} from "./form-ai/vision";
import { napiRender } from "./form-ai/render";
import type { DetectedFieldType } from "./form-ai/types";
import type { TypeField } from "./form-types-seed";

const MAX_PAGES = 50; // matches the renderer cap; bounds a malicious many-page PDF
const VALID = new Set<DetectedFieldType>(["text", "checkbox", "signature", "initial", "date"]);
const coerce = (t: string): DetectedFieldType => (VALID.has(t as DetectedFieldType) ? (t as DetectedFieldType) : "text");

/**
 * Detect + place fields for one 'detecting' vision form, then flip it to
 * pending_review. Idempotent: a no-op unless the form is still 'detecting', and
 * it replaces any prior fields in one transaction (a retried job can't double-write).
 */
export async function runFormDetectJob(formId: string): Promise<void> {
  const form = await prisma.uploaded_forms.findUnique({
    where: { id: formId },
    select: { id: true, status: true, side: true, source_s3_key: true, form_type_id: true },
  });
  if (!form) return; // form deleted
  if (form.status !== "detecting") return; // already processed (idempotent)
  if (!form.form_type_id) {
    // No type to guide vision — nothing to locate. Send to review empty rather
    // than strand it in 'detecting'.
    await prisma.uploaded_forms.update({ where: { id: formId }, data: { status: "pending_review" } });
    return;
  }

  const type = await prisma.form_types.findUnique({
    where: { id: form.form_type_id },
    select: { field_set: true },
  });
  const fieldSet = (Array.isArray(type?.field_set) ? type!.field_set : []) as unknown as TypeField[];
  const bytes = await getObjectBytes(form.source_s3_key);
  const pageCount = Math.min(
    (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount(),
    MAX_PAGES
  );

  // Real path renders all pages ONCE (a memoized renderer) so each per-page locate
  // call doesn't re-rasterize. Tests inject a fake detector — no render at all.
  const injected = getInjectedVisionDetector();
  let detector: VisionFieldDetector;
  if (injected) {
    detector = injected;
  } else {
    const renderStart = Date.now();
    const pages = await napiRender(bytes);
    console.log(`[form-detect ${formId}] rendered ${pages.length}p in ${Date.now() - renderStart}ms`);
    const cached: PageRenderer = async () => pages;
    detector = new ClaudeVisionDetector(cached, undefined, VISION_CALIBRATE_Y);
  }
  const detectGuided = detector.detectGuided?.bind(detector);
  if (!detectGuided) throw new Error("vision detector has no detectGuided");

  // On a NEW layout we don't know a field's page, so query EVERY page with the FULL
  // field list and NO position hints (the exact Phase 0 protocol). Build the whole
  // query up front and hand it to detectGuided in ONE call so it runs the per-page
  // vision requests CONCURRENTLY — calling it once-per-page (each call seeing a single
  // page) serialized ~30-60s/page and blew the function's 300s budget on a long form.
  const base = fieldSet.map((f) => ({ label: f.label, type: coerce(f.type) }));
  const expected: ExpectedField[] = [];
  for (let p = 1; p <= pageCount; p++) {
    for (const e of base) expected.push({ ...e, page: p });
  }
  const visionStart = Date.now();
  const located = await detectGuided({ pdfBytes: bytes, expected });
  console.log(
    `[form-detect ${formId}] vision ${pageCount}p × ${base.length}f in ${Date.now() - visionStart}ms, located ${located.length}`
  );

  // Map each located box back to its type field (mapping is from the type, not a
  // guess → mapping is pre-resolved; needs_review=false so ONLY placement gates).
  const byLabel = new Map(fieldSet.map((f) => [f.label, f]));
  const rows = located
    .map((d) => {
      const tf = byLabel.get(d.name);
      if (!tf) return null;
      return {
        form_id: formId,
        detected_name: d.name,
        detected_type: d.type,
        page_number: d.page,
        pos_x: d.rect.x,
        pos_y: d.rect.y,
        width: d.rect.width,
        height: d.rect.height,
        nearby_text: d.nearbyText ?? tf.label,
        ai_core_key: tf.core_key,
        ai_role: tf.role,
        ai_confidence: 1, // mapping known from the type
        ai_rationale: "vision-located on the agent's layout; mapping from the document type",
        needs_review: false, // mapping resolved; PLACEMENT is gated separately
        final_core_key: tf.core_key,
        final_role: tf.role,
        final_type: tf.type,
        decision: "accepted",
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  await prisma.$transaction(async (tx) => {
    // Re-read under the tx so a concurrent sweep can't double-process.
    const fresh = await tx.uploaded_forms.findUnique({ where: { id: formId }, select: { status: true } });
    if (fresh?.status !== "detecting") return;
    await tx.uploaded_form_fields.deleteMany({ where: { form_id: formId } });
    if (rows.length) await tx.uploaded_form_fields.createMany({ data: rows });
    await tx.uploaded_forms.update({ where: { id: formId }, data: { status: "pending_review" } });
  });
}

// ── inline attempt on upload (#193) ─────────────────────────────────────────

/** Inline detect attempts still in flight (see waitForInlineFormDetects). */
const inflightInlineDetects = new Set<Promise<void>>();

/**
 * Kick off detection for a just-created 'detecting' form WITHOUT blocking the
 * upload response — the calendar-push shape (lib/jobs.ts: enqueue durable job →
 * attempt inline → cron sweeps failures) adapted for a job that takes minutes,
 * not milliseconds, so the attempt is fire-and-forget instead of awaited.
 *
 * The attempt promise is created EAGERLY (work starts now) and then handed to
 * next/server `after()`, which on Vercel extends the invocation until it
 * settles — a bare detached promise could be frozen mid-flight the moment the
 * response is sent. Outside a request scope `after()` throws (Vitest invokes
 * routes as plain functions — the nondeterminism lib/audit.ts documents); there
 * the process doesn't freeze on response, so the already-running promise simply
 * completes, and tests await it via `waitForInlineFormDetects()`.
 *
 * Outcomes:
 * - success → consume the durable job (`includeQueued` completes a never-
 *   fetched job) so the daily sweep's budget isn't spent no-op'ing forms that
 *   already detected. A lost race just re-runs runFormDetectJob, whose
 *   idempotent 'detecting' guard makes that a no-op.
 * - failure → swallow and log; the job stays queued for the cron sweep.
 * The attempt promise itself NEVER rejects.
 */
export function scheduleInlineFormDetect(formId: string, jobId: string | null): void {
  const attempt = (async () => {
    try {
      await runFormDetectJob(formId);
    } catch (err) {
      console.error(
        `inline form-detect failed for ${formId}; job ${jobId ?? "?"} left queued for the cron sweep`,
        err
      );
      return;
    }
    if (!jobId) return;
    try {
      const boss = await getBoss();
      await boss.complete(FORM_DETECT_QUEUE, jobId, null, { includeQueued: true });
    } catch (err) {
      console.error(
        `form-detect job ${jobId} finished inline but couldn't be marked complete; the sweep will no-op (idempotent)`,
        err
      );
    }
  })();
  inflightInlineDetects.add(attempt);
  void attempt.finally(() => inflightInlineDetects.delete(attempt));
  try {
    after(attempt); // Vercel: keep the invocation alive until detection settles
  } catch {
    // No request scope (tests / scripts) — the promise above runs on its own.
  }
}

/**
 * Resolves once every scheduled inline detect attempt has settled. Tests await
 * this for determinism (the attempts are fire-and-forget by design); nothing
 * in the request path should ever need it.
 */
export async function waitForInlineFormDetects(): Promise<void> {
  while (inflightInlineDetects.size > 0) {
    await Promise.allSettled([...inflightInlineDetects]);
  }
}
