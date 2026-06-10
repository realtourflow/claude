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
import { processCalendarJobs } from "@/lib/queue";

async function handle(req: Request): Promise<Response> {
  const secret = env().CRON_SECRET;
  if (!secret) return error("cron secret not configured", 503);

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) return error("unauthorized", 401);

  try {
    const counts = await processCalendarJobs({ limit: 25 });
    return json(counts);
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
