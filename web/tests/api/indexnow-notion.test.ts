/**
 * /api/indexnow/notion — the token-authed webhook a Notion "Send webhook"
 * automation calls the instant a post is Published.
 *
 * No DB or network: Notion faked via `setNotionForTesting`, the IndexNow
 * endpoint via `setIndexNowSubmitForTesting`.
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
import {
  GET as notionGET,
  POST as notionPOST,
} from "@/app/api/indexnow/notion/route";
import { resetEnvForTesting } from "@/lib/env";
import { setIndexNowSubmitForTesting, type SubmitResult } from "@/lib/indexnow";
import { setNotionForTesting } from "@/lib/notion";

const TOKEN = "test-webhook-secret";
const BASE = "https://www.realtourflow.com";

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

function fakeNotion(pages: ReturnType<typeof page>[]) {
  return {
    databases: { query: async () => ({ results: pages }) },
  } as unknown as Parameters<typeof setNotionForTesting>[0];
}

function req(init: RequestInit = {}, query = ""): Request {
  return new Request(`http://localhost/api/indexnow/notion${query}`, init);
}

let captured: string[][];
let stubResult: SubmitResult;

beforeAll(() => {
  process.env.INDEXNOW_WEBHOOK_SECRET = TOKEN;
  process.env.NOTION_BLOG_DATABASE_ID = "test-blog-db";
  resetEnvForTesting();
});

afterAll(() => {
  delete process.env.INDEXNOW_WEBHOOK_SECRET;
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

describe("GET/POST /api/indexnow/notion", () => {
  it("503 when INDEXNOW_WEBHOOK_SECRET is unset — even with a token", async () => {
    process.env.INDEXNOW_WEBHOOK_SECRET = "";
    resetEnvForTesting();
    try {
      const res = await notionPOST(req({ method: "POST" }, `?token=${TOKEN}`));
      expect(res.status).toBe(503);
    } finally {
      process.env.INDEXNOW_WEBHOOK_SECRET = TOKEN;
      resetEnvForTesting();
    }
  });

  it("401 with a missing or wrong token", async () => {
    expect((await notionPOST(req({ method: "POST" }))).status).toBe(401);
    expect(
      (await notionPOST(req({ method: "POST" }, "?token=nope"))).status
    ).toBe(401);
  });

  it("200 with the token in the query string → pings the just-published post", async () => {
    setNotionForTesting(fakeNotion([page("just-live", new Date().toISOString())]));

    const res = await notionPOST(req({ method: "POST" }, `?token=${TOKEN}`));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { skipped: boolean; submitted: string[] };
    expect(body.skipped).toBe(false);
    expect(body.submitted).toContain(`${BASE}/blog/just-live`);
    expect(captured).toHaveLength(1);
  });

  it("200 with the token in the x-indexnow-token header (GET)", async () => {
    setNotionForTesting(fakeNotion([page("just-live", new Date().toISOString())]));

    const res = await notionGET(
      req({ headers: { "x-indexnow-token": TOKEN } })
    );

    expect(res.status).toBe(200);
    expect(captured).toHaveLength(1);
  });

  it("ignores the request body (Notion posts its own payload)", async () => {
    setNotionForTesting(fakeNotion([page("just-live", new Date().toISOString())]));

    const res = await notionPOST(
      req(
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ some: "notion payload", data: [1, 2, 3] }),
        },
        `?token=${TOKEN}`
      )
    );

    expect(res.status).toBe(200);
    expect(captured).toHaveLength(1);
  });
});
