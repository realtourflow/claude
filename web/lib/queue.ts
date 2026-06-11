/**
 * Durable calendar-push queue — pg-boss wrapper (FF4, #22).
 *
 * Architecture: **enqueue durable job → attempt inline immediately → Vercel
 * Cron sweeps failures.** The mutation path (deal stage / task create+status)
 * still does the real-time push itself — the pg-boss job row is the durability
 * record. If the inline attempt fails (transient Google/Microsoft outage), the
 * job stays queued and `processCalendarJobs` — invoked by Vercel Cron hitting
 * `POST /api/jobs/process` — retries it with exponential backoff.
 *
 * Schema: we deliberately rely on pg-boss's OWN schema init (`start()` creates
 * and migrates the `pgboss` schema), NOT a golang-migrate file. pg-boss's
 * internal schema is version-managed by the library across upgrades; checking
 * a snapshot into migrations/ would fight that. Our app tables are
 * untouched — everything pg-boss owns lives in the separate `pgboss` schema.
 *
 * Worker host: Vercel serverless can't run a resident worker, so the sweep is
 * a cron-invoked route. On the Hobby plan crons are daily-only, so
 * web/vercel.json ships a daily-safe schedule (`0 6 * * *`); on Pro, tighten it
 * to every 5 minutes — cron `0-59/5 * * * *` (the star-slash spelling of the
 * same schedule can't appear inside this block comment). The sweep is a
 * BACKSTOP, not the primary path — real-time delivery comes from the inline
 * attempt, so the daily cadence only bounds how long an outage-dropped event
 * waits.
 */
import { PgBoss } from "pg-boss";
import { env } from "./env";

/** The single queue all calendar push jobs go through. */
export const CALENDAR_QUEUE = "calendar-push";

export type CalendarJobPayload = {
  kind: "deal-closing" | "task-due";
  /** deal id for `deal-closing`, task id for `task-due`. */
  id: string;
};

/**
 * Retry policy: 8 attempts with exponential backoff starting at 60s
 * (≈1min → 2min → 4min → … capped at 6h), so a multi-hour provider outage is
 * survived without hammering anyone. Failed-beyond-retryLimit jobs stay in the
 * pgboss tables (state `failed`) for post-mortem until retention expires.
 */
type RetryPolicy = {
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
  retryDelayMax?: number;
};

const RETRY_OPTIONS: RetryPolicy = {
  retryLimit: 8,
  retryDelay: 60,
  retryBackoff: true,
  retryDelayMax: 6 * 60 * 60,
};

// ── lazy singleton ──────────────────────────────────────────────────────────

let bossPromise: Promise<PgBoss> | undefined;

/**
 * Module-level singleton: one started PgBoss per process. `start()` is slow
 * (schema check + pool), so it runs once and everyone awaits the same promise.
 * v12 requires explicit queue creation, so the queue is ensured here too
 * (`createQueue` is idempotent — `ON CONFLICT DO NOTHING`).
 */
export function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    bossPromise = (async () => {
      const boss = new PgBoss({
        connectionString: env().DATABASE_URL,
        // No pg-boss cron scheduling — Vercel Cron drives the sweep.
        schedule: false,
      });
      // Without a listener an emitted 'error' (e.g. from the supervision
      // timer) would crash the process.
      boss.on("error", (err) => console.error("pg-boss error", err));
      await boss.start();
      await boss.createQueue(CALENDAR_QUEUE, { ...RETRY_OPTIONS });
      return boss;
    })();
    // A failed start must not poison the singleton — let the next caller retry.
    bossPromise.catch(() => {
      bossPromise = undefined;
    });
  }
  return bossPromise;
}

/**
 * Test/shutdown helper: stops the singleton (closes the pg pool + supervision
 * timers) so the process — vitest workers especially — can exit cleanly.
 */
export async function stopBossForTesting(): Promise<void> {
  if (!bossPromise) return;
  const pending = bossPromise;
  bossPromise = undefined;
  try {
    const boss = await pending;
    await boss.stop({ close: true, graceful: false });
  } catch {
    // Boss never started successfully — nothing to stop.
  }
}

// ── enqueue / consume ───────────────────────────────────────────────────────

type RetryOverrides = Partial<RetryPolicy>;

/**
 * Inserts a durable calendar job. Returns the pg-boss job id (null only for
 * deduped sends, which standard-policy sends never produce).
 * `overrides` exists for tests that need e.g. `retryDelay: 0`.
 */
export async function enqueueCalendarJob(
  payload: CalendarJobPayload,
  overrides: RetryOverrides = {}
): Promise<string | null> {
  const boss = await getBoss();
  const opts: RetryOverrides = { ...RETRY_OPTIONS, ...overrides };
  // pg-boss rejects retryDelayMax unless retryBackoff is on.
  if (!opts.retryBackoff) delete opts.retryDelayMax;
  return boss.send(CALENDAR_QUEUE, payload, opts);
}

/**
 * Marks a job completed even though it was never fetched (`includeQueued`
 * completes jobs in created/retry state). The inline path calls this after a
 * successful push so the cron sweep doesn't re-push it. A lost race (sweep
 * fetched the job between send and complete) only causes a redundant PATCH —
 * harmless, calendar_event_map keeps it idempotent.
 */
export async function completeCalendarJob(jobId: string): Promise<void> {
  const boss = await getBoss();
  await boss.complete(CALENDAR_QUEUE, jobId, null, { includeQueued: true });
}

// ── the sweep (worker) ──────────────────────────────────────────────────────

export type ProcessResult = { processed: number; failed: number };

/**
 * Fetches up to `limit` due jobs and dispatches each to its processor.
 * Success → `complete`; throw → `fail`, which is what schedules the pg-boss
 * retry with backoff (or parks the job as `failed` after retryLimit).
 *
 * Called from the cron route; safe to call concurrently (fetch uses
 * FOR UPDATE SKIP LOCKED).
 */
export async function processCalendarJobs(
  opts: { limit?: number } = {}
): Promise<ProcessResult> {
  const limit = opts.limit ?? 25;
  const boss = await getBoss();

  // Recover jobs stranded in `active` by a crashed/timed-out previous sweep:
  // supervision fails expired jobs, putting them back on the retry track. On
  // serverless the interval-based supervision timer can't be relied on (the
  // process freezes between invocations), so run one pass explicitly.
  await boss.supervise(CALENDAR_QUEUE);

  const jobs = await boss.fetch<CalendarJobPayload>(CALENDAR_QUEUE, { batchSize: limit });

  // Lazy import breaks the module cycle: lib/jobs.ts statically imports the
  // enqueue side of this file, so the processors are resolved at dispatch time.
  const { processDealClosingPush, processTaskDuePush } = await import("./jobs");

  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const { kind, id } = job.data;
      if (kind === "deal-closing") {
        await processDealClosingPush(id);
      } else if (kind === "task-due") {
        await processTaskDuePush(id);
      } else {
        throw new Error(`unknown calendar job kind: ${String(kind)}`);
      }
      await boss.complete(CALENDAR_QUEUE, job.id);
      processed += 1;
    } catch (err) {
      failed += 1;
      console.error(`calendar job ${job.id} failed; pg-boss will retry with backoff`, err);
      await boss.fail(CALENDAR_QUEUE, job.id, {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { processed, failed };
}
