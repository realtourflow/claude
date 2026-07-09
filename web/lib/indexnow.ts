/**
 * IndexNow — instant search-engine indexing for the marketing blog.
 *
 * IndexNow is the protocol Bing (and Yandex, Seznam, …) expose so a site can
 * *push* "this URL changed, re-crawl it" instead of waiting for the next
 * sitemap crawl. We already serve the ownership key at
 * `web/public/<KEY>.txt`; this module is the missing piece that actually pings
 * the endpoint when a post is published or edited.
 *
 * How it's driven (lib is the shared core):
 *  - GET  /api/indexnow  — daily Vercel Cron sweep (submitRecentlyChanged).
 *    Daily, not hourly, because the Vercel Hobby plan caps crons at one run
 *    per day; a more frequent schedule makes the deployment fail. For same-day
 *    indexing use the POST hook below (or move the site to a plan that allows
 *    sub-daily crons and drop the schedule back to hourly).
 *  - POST /api/indexnow  — manual/ops trigger; with `{ urls: [...] }` it
 *    submits exactly those URLs (e.g. the auto-publish pipeline pinging the new
 *    post the moment it flips to Published, for true instant indexing — the way
 *    to get a post to Bing within seconds rather than waiting for the sweep).
 *
 * Design note — this is intentionally stateless. Rather than persist "already
 * submitted" rows, the sweep re-submits whatever changed inside a lookback
 * window slightly larger than the cron interval. Re-submitting an
 * unchanged-since URL is explicitly harmless per the IndexNow spec, and the
 * window (not a fixed "last run" marker) means a skipped cron run self-heals
 * on the next tick. No migration, no dedup table to maintain.
 */
import { getPublishedPosts } from "@/lib/notion";

// Ownership key. Must equal the filename+contents served at
// `web/public/9f2c7a14e0b84d3596af1c6e8b2705d3.txt` (and the path allow-listed
// in middleware.ts). It is public by design — not a secret.
const KEY = "9f2c7a14e0b84d3596af1c6e8b2705d3";
const HOST = "www.realtourflow.com";
const BASE = `https://${HOST}`;
const KEY_LOCATION = `${BASE}/${KEY}.txt`;
// api.indexnow.org fans a single submission out to every participating engine
// (Bing included) — one call covers them all.
const ENDPOINT = "https://api.indexnow.org/indexnow";
// Notion "Publish To" tag for this site (see lib/notion publishedFilter).
const SITE = "RealTourFlow";

// Lookback for the periodic sweep. Kept larger than the cron interval (daily,
// 24h) so a change published just after a run — plus a couple hours of cron
// jitter — is still caught by the next one; the harmless cost is that a URL
// changed in the ~2h overlap may be submitted on two consecutive days.
export const DEFAULT_LOOKBACK_MINUTES = 26 * 60;

export type SubmitResult = { ok: boolean; status: number };
type SubmitFn = (urls: string[]) => Promise<SubmitResult>;

let submitStub: SubmitFn | null | undefined;

/** Test seam — inject a fake submitter (or `null` to restore the real one). */
export function setIndexNowSubmitForTesting(fn: SubmitFn | null): void {
  submitStub = fn ?? undefined;
}

async function submitReal(urls: string[]): Promise<SubmitResult> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: HOST,
      key: KEY,
      keyLocation: KEY_LOCATION,
      urlList: urls,
    }),
  });
  // 200 (accepted) and 202 (received, key validation pending) both mean the
  // submission was taken. Anything else (403 bad key, 422 host mismatch, 429
  // rate-limited, 5xx) is a failure the caller surfaces/logs.
  return { ok: res.status === 200 || res.status === 202, status: res.status };
}

function submit(urls: string[]): Promise<SubmitResult> {
  return (submitStub ?? submitReal)(urls);
}

/** Keep only URLs on our own host (IndexNow rejects a mixed-host batch) + dedupe. */
function sanitize(urls: string[]): string[] {
  return [...new Set(urls.filter((u) => u.startsWith(`${BASE}/`)))];
}

export type SweepResult = {
  submitted: string[];
  skipped: boolean;
  status?: number;
};

/**
 * Find posts changed within the lookback window and push them (plus the home +
 * blog-index pages, since the listing changed too). No-op when nothing changed.
 */
export async function submitRecentlyChanged(opts?: {
  lookbackMinutes?: number;
  now?: number;
}): Promise<SweepResult> {
  const lookback = opts?.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES;
  const now = opts?.now ?? Date.now();
  const cutoff = now - lookback * 60_000;

  const posts = await getPublishedPosts(SITE);
  const changed = posts.filter((p) => {
    const edited = p.lastEdited ? Date.parse(p.lastEdited) : NaN;
    return Number.isFinite(edited) && edited >= cutoff;
  });
  if (changed.length === 0) return { submitted: [], skipped: true };

  const urls = sanitize([
    `${BASE}/`,
    `${BASE}/blog`,
    ...changed.map((p) => `${BASE}/blog/${p.slug}`),
  ]);
  const { ok, status } = await submit(urls);
  return { submitted: ok ? urls : [], skipped: false, status };
}

export type SubmitUrlsResult = { submitted: string[]; status: number };

/**
 * Submit an explicit URL list immediately — the hook for "ping Bing the instant
 * this post goes live" rather than waiting for the next sweep. Off-host and
 * duplicate URLs are dropped; an empty result is a no-op (status 0).
 */
export async function submitUrls(urls: string[]): Promise<SubmitUrlsResult> {
  const clean = sanitize(urls);
  if (clean.length === 0) return { submitted: [], status: 0 };
  const { ok, status } = await submit(clean);
  return { submitted: ok ? clean : [], status };
}
