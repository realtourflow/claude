/**
 * IndexNow instant-indexing — lib core (submit sweep + explicit submit) and the
 * /api/indexnow cron/manual route.
 *
 * No DB or network: Notion is faked via `setNotionForTesting` (only
 * `databases.query` is exercised) and the IndexNow endpoint via
 * `setIndexNowSubmitForTesting`, which captures the URL batches that would be
 * POSTed to api.indexnow.org.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { GET as indexnowGET, POST as indexnowPOST } from "@/app/api/indexnow/route";
import { resetEnvForTesting } from "@/lib/env";
import {
  submitRecentlyChanged,
  submitUrls,
  setIndexNowSubmitForTesting,
  type SubmitResult,
} from "@/lib/indexnow";
import { setNotionForTesting } from "@/lib/notion";

const CRON = "test-cron-secret";
const BASE = "https://www.realtourflow.com";

// A minimal Notion page shaped like what metaFromPage() reads.
function page(slug: string, lastEdited: string) {
  return {
    id: `id-${slug}`,
    last_edited_time: lastEdited,
    properties: {
      Title: { title: [{ plain_text: slug }] },
      Slug: { rich_text: [{ plain_text: slug }] },
      Excerpt: { rich_text: [] },
      "Publish Date": { date: { start: "2026-01-01" } },
      Author: { rich_text: [] },
      Tags: { multi_select: [] },
      "Cover Image": { files: [] },
    },
  };
}

// Fake Notion client — getPublishedPosts only calls databases.query().
function fakeNotion(pages: ReturnType<typeof page>[]) {
  return {
    databases: { query: async () => ({ results: pages }) },
  } as unknown as Parameters<typeof setNotionForTesting>[0];
}

function req(init: RequestInit = {}): Request {
  return new Request("http://localhost/api/indexnow", init);
}

let captured: string[][];
let stubResult: SubmitResult;

beforeAll(() => {
  process.env.CRON_SECRET = CRON;
  process.env.NOTION_BLOG_DATABASE_ID = "test-blog-db";
  resetEnvForTesting();
});

afterAll(() => {
  delete process.env.CRON_SECRET;
  delete process.env.NOTION_BLOG_DATABASE_ID;
  resetEnvForTesting();
  setNotionForTesting(null);
  setIndexNowSubmitForTesting(null);
});

beforeEach(() => {
  captured = [];
  stubResult = { ok: true, status: 200 };
  setIndexNowSubmitForTesting(async (urls) => {
    captured.push(urls);
    return stubResult;
  });
});

afterEach(() => {
  setNotionForTesting(null);
});

// ── lib: submitRecentlyChanged ──────────────────────────────────────────────

describe("submitRecentlyChanged", () => {
  const now = Date.parse("2026-07-08T12:00:00Z");

  it("submits changed posts + home + blog index, excludes stale ones", async () => {
    setNotionForTesting(
      fakeNotion([
        page("fresh-post", "2026-07-08T11:30:00Z"), // 30 min ago → in window
        page("stale-post", "2026-07-08T06:00:00Z"), // 6 h ago → outside 120 min
      ])
    );

    const res = await submitRecentlyChanged({ now });

    expect(res.skipped).toBe(false);
    expect(res.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual([
      `${BASE}/`,
      `${BASE}/blog`,
      `${BASE}/blog/fresh-post`,
    ]);
    expect(res.submitted).toContain(`${BASE}/blog/fresh-post`);
    expect(res.submitted).not.toContain(`${BASE}/blog/stale-post`);
  });

  it("no-ops (skipped) when nothing changed in the window", async () => {
    setNotionForTesting(fakeNotion([page("stale-post", "2026-07-01T00:00:00Z")]));

    const res = await submitRecentlyChanged({ now });

    expect(res).toEqual({ submitted: [], skipped: true });
    expect(captured).toHaveLength(0);
  });

  it("reports nothing submitted when the endpoint rejects the batch", async () => {
    stubResult = { ok: false, status: 403 };
    setNotionForTesting(fakeNotion([page("fresh-post", "2026-07-08T11:59:00Z")]));

    const res = await submitRecentlyChanged({ now });

    expect(res.status).toBe(403);
    expect(res.submitted).toEqual([]);
    expect(captured).toHaveLength(1); // attempted, then reported as failed
  });
});

// ── lib: submitUrls (explicit list) ─────────────────────────────────────────

describe("submitUrls", () => {
  it("submits on-host URLs, dropping off-host and duplicates", async () => {
    const res = await submitUrls([
      `${BASE}/blog/a`,
      `${BASE}/blog/a`, // duplicate
      "https://evil.example/x", // off-host
      `${BASE}/blog/b`,
    ]);

    expect(captured[0]).toEqual([`${BASE}/blog/a`, `${BASE}/blog/b`]);
    expect(res.status).toBe(200);
    expect(res.submitted).toEqual([`${BASE}/blog/a`, `${BASE}/blog/b`]);
  });

  it("no-ops (status 0) when no URL is on our host", async () => {
    const res = await submitUrls(["https://evil.example/x"]);

    expect(res).toEqual({ submitted: [], status: 0 });
    expect(captured).toHaveLength(0);
  });
});

// ── route: /api/indexnow ────────────────────────────────────────────────────

describe("GET/POST /api/indexnow", () => {
  it("401 without a bearer, and with the wrong bearer", async () => {
    expect((await indexnowGET(req())).status).toBe(401);
    expect((await indexnowPOST(req({ method: "POST" }))).status).toBe(401);
    expect(
      (await indexnowGET(req({ headers: { authorization: "Bearer nope" } }))).status
    ).toBe(401);
  });

  it("503 when CRON_SECRET is unset — even with an empty bearer", async () => {
    process.env.CRON_SECRET = "";
    resetEnvForTesting();
    try {
      const res = await indexnowGET(req({ headers: { authorization: "Bearer " } }));
      expect(res.status).toBe(503);
    } finally {
      process.env.CRON_SECRET = CRON;
      resetEnvForTesting();
    }
  });

  it("GET (cron) sweeps recently-changed posts", async () => {
    setNotionForTesting(fakeNotion([page("just-live", new Date().toISOString())]));

    const res = await indexnowGET(
      req({ headers: { authorization: `Bearer ${CRON}` } })
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { skipped: boolean; submitted: string[] };
    expect(body.skipped).toBe(false);
    expect(body.submitted).toContain(`${BASE}/blog/just-live`);
  });

  it("POST with an explicit url list submits exactly those (off-host dropped)", async () => {
    setNotionForTesting(fakeNotion([]));

    const res = await indexnowPOST(
      req({
        method: "POST",
        headers: {
          authorization: `Bearer ${CRON}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          urls: [`${BASE}/blog/manual`, "https://evil.example/x"],
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { submitted: string[] };
    expect(body.submitted).toEqual([`${BASE}/blog/manual`]);
    expect(captured.at(-1)).toEqual([`${BASE}/blog/manual`]);
  });

  it("POST with no body falls back to a sweep", async () => {
    setNotionForTesting(fakeNotion([])); // nothing changed → skipped

    const res = await indexnowPOST(
      req({ method: "POST", headers: { authorization: `Bearer ${CRON}` } })
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { skipped: boolean };
    expect(body.skipped).toBe(true);
  });
});
