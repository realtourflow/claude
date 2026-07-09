/**
 * GET/POST /api/indexnow/notion — instant IndexNow ping when a post publishes.
 *
 * Wired to a Notion "Blog Posts" database automation ("When Status is set to
 * Published → Send webhook") so Bing is notified within seconds of publishing
 * instead of waiting for the daily cron sweep (/api/indexnow).
 *
 * Notion's webhook action can't set an Authorization header or a computed JSON
 * body, so — unlike the bearer-gated /api/indexnow — this endpoint authenticates
 * with a token carried in the URL (`?token=…`) or an `x-indexnow-token` header,
 * and ignores the request body entirely. It just triggers a short-window sweep,
 * which catches the just-published post (its `last_edited_time` is seconds old)
 * plus anything else changed in the last couple hours. Submitting is idempotent,
 * so a stray extra fire is harmless.
 *
 * Auth: INDEXNOW_WEBHOOK_SECRET unset → 503 (endpoint disabled; never compare
 * against an empty secret); wrong/missing token → 401.
 */
import { env } from "@/lib/env";
import { error, json } from "@/lib/http";
import { submitRecentlyChanged } from "@/lib/indexnow";

export const maxDuration = 30;

// The post is edited (Status→Published) moments before Notion fires the hook, so
// a small window reliably includes it while re-pinging little else.
const WEBHOOK_LOOKBACK_MINUTES = 120;

function tokenFrom(req: Request): string | null {
  const fromQuery = new URL(req.url).searchParams.get("token");
  return fromQuery ?? req.headers.get("x-indexnow-token");
}

async function handle(req: Request): Promise<Response> {
  const secret = env().INDEXNOW_WEBHOOK_SECRET;
  if (!secret) return error("indexnow webhook not configured", 503);
  if (tokenFrom(req) !== secret) return error("unauthorized", 401);

  try {
    const result = await submitRecentlyChanged({
      lookbackMinutes: WEBHOOK_LOOKBACK_MINUTES,
    });
    return json(result);
  } catch (err) {
    console.error("indexnow webhook sweep failed", err);
    return error("indexnow webhook failed", 500);
  }
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
