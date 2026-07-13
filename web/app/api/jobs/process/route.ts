/**
 * POST/GET /api/jobs/process — the durable-queue sweep (FF4, #22).
 *
 * Invoked by Vercel Cron (see web/vercel.json; crons send GET with
 * `Authorization: Bearer ${CRON_SECRET}` when that env var is set). POST is
 * accepted too for manual/ops triggering. Drains up to 25 calendar jobs whose
 * inline attempt failed; pg-boss retry/backoff handles the rest.
 *
 * Auth: CRON_SECRET unset → 503 (endpoint disabled — never fall through to a
 * comparison against an empty secret). Wrong/missing bearer → 401.
 */
import { env } from "@/lib/env";
import { error, json } from "@/lib/http";
import {
  processCalendarJobs,
  processFormDetectJobs,
  type ProcessResult,
} from "@/lib/queue";

// Vision detect jobs are slow (a dense form is ~14 model calls + a render). Give
// the sweep room so one can finish in a single invocation.
export const maxDuration = 300;

// Stop pulling NEW detect jobs once this much of the invocation is spent, so an
// in-flight vision run isn't killed by maxDuration mid-job.
const DETECT_DRAIN_BUDGET_MS = 240_000;

/**
 * Drain form-detect jobs until the queue has nothing due or the time budget is
 * spent — ONE job per fetch, since each can take minutes (#193). With inline
 * detection as the primary path this queue holds only failures/lost races, but
 * on the Hobby plan the cron fires once a DAY, so the old fixed 3-job batch let
 * a backlog outgrow the sweep; draining clears it in a single invocation. A job
 * that outlives the budget anyway dies with the function — the next sweep's
 * `supervise` fails it back onto the retry track.
 */
async function drainFormDetectJobs(): Promise<ProcessResult> {
  const started = Date.now();
  const total: ProcessResult = { processed: 0, failed: 0 };
  while (Date.now() - started < DETECT_DRAIN_BUDGET_MS) {
    const r = await processFormDetectJobs({ limit: 1 });
    total.processed += r.processed;
    total.failed += r.failed;
    if (r.processed + r.failed === 0) break; // nothing due (failed jobs sit in retry delay)
  }
  return total;
}

async function handle(req: Request): Promise<Response> {
  const secret = env().CRON_SECRET;
  if (!secret) return error("cron secret not configured", 503);

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) return error("unauthorized", 401);

  try {
    const [calendar, detect] = await Promise.all([
      processCalendarJobs({ limit: 25 }),
      drainFormDetectJobs(),
    ]);
    return json({ calendar, detect });
  } catch (err) {
    console.error("job sweep failed", err);
    return error("job sweep failed", 500);
  }
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
