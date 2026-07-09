/**
 * GET/POST /api/indexnow — push changed blog URLs to IndexNow (Bing et al.).
 *
 * GET  — the daily Vercel Cron sweep (see web/vercel.json; daily because the
 *        Hobby plan caps cron frequency). Vercel sends
 *        `Authorization: Bearer ${CRON_SECRET}` when that env var is set.
 *        Submits every post changed within the lookback window.
 * POST — manual/ops trigger. Same sweep by default; with a JSON body of
 *        `{ "urls": ["https://www.realtourflow.com/blog/..."] }` it submits
 *        exactly those URLs (the "ping the instant a post publishes" hook).
 *
 * Auth mirrors /api/jobs/process: CRON_SECRET unset → 503 (endpoint disabled,
 * never compare against an empty secret); wrong/missing bearer → 401.
 */
import { env } from "@/lib/env";
import { error, json } from "@/lib/http";
import { submitRecentlyChanged, submitUrls } from "@/lib/indexnow";

// A submission is a single outbound POST; the default 300s isn't needed, but a
// small ceiling keeps a hung upstream from pinning the function.
export const maxDuration = 30;

function authOrError(req: Request): Response | null {
  const secret = env().CRON_SECRET;
  if (!secret) return error("cron secret not configured", 503);
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return error("unauthorized", 401);
  }
  return null;
}

export async function GET(req: Request): Promise<Response> {
  const denied = authOrError(req);
  if (denied) return denied;
  try {
    return json(await submitRecentlyChanged());
  } catch (err) {
    console.error("indexnow sweep failed", err);
    return error("indexnow sweep failed", 500);
  }
}

export async function POST(req: Request): Promise<Response> {
  const denied = authOrError(req);
  if (denied) return denied;
  try {
    const urls = await explicitUrls(req);
    if (urls.length > 0) return json(await submitUrls(urls));
    return json(await submitRecentlyChanged());
  } catch (err) {
    console.error("indexnow submit failed", err);
    return error("indexnow submit failed", 500);
  }
}

/** Parse an optional `{ urls: string[] }` body; anything malformed → []. */
async function explicitUrls(req: Request): Promise<string[]> {
  try {
    const body: unknown = await req.json();
    const urls = (body as { urls?: unknown } | null)?.urls;
    if (!Array.isArray(urls)) return [];
    return urls.filter((u): u is string => typeof u === "string");
  } catch {
    return [];
  }
}
