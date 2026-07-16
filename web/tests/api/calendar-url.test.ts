/**
 * Calendar feed URL contract (#298) + feed-token rotation (#297).
 *
 * GET /api/me/calendar-url returns { feed_url, webcal_url, url, token } —
 * CalendarPage's Subscribe / Copy-URL / .ics controls read `webcal_url` and
 * `feed_url`; `url`/`token` stay for backward compatibility (#298).
 *
 * POST /api/me/calendar-url/rotate regenerates `calendar_token` behind the
 * agent's own Auth0 session (#297). The public iCal feed route matches on
 * `calendar_token`, so the moment the column changes the old
 * `webcal://.../feed.ics` URL 404s — the revoke path for a leaked link.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { GET as calendarUrlRoute } from "@/app/api/me/calendar-url/route";
import { POST as rotateRoute } from "@/app/api/me/calendar-url/rotate/route";
import { GET as feedRoute } from "@/app/api/calendar/[token]/feed.ics/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/factories";

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
});

beforeEach(async () => {
  await truncateAll();
});

// ---------------------------------------------------------------------------
// GET /api/me/calendar-url — response shape (#298)
// ---------------------------------------------------------------------------

async function calendarUrlReq(base = "https://app.realtourflow.com") {
  return new Request(`${base}/api/me/calendar-url`, {
    headers: { authorization: await authHeader("auth0|a", ["agent"]) },
  });
}

describe("GET /api/me/calendar-url (issue #298)", () => {
  it("returns a webcal:// subscribe URL and an https:// feed URL", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });

    const res = await calendarUrlRoute(await calendarUrlReq());
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      feed_url: string;
      webcal_url: string;
      url: string;
      token: string;
    };

    // The subscribe control opens webcal:// so the OS hands it to the
    // default calendar app.
    expect(body.webcal_url).toMatch(/^webcal:\/\//);
    expect(body.webcal_url).toMatch(
      /^webcal:\/\/app\.realtourflow\.com\/api\/calendar\/[a-f0-9]{48}\/feed\.ics$/,
    );

    // The .ics download uses the plain https:// feed URL.
    expect(body.feed_url).toMatch(/^https:\/\//);
    expect(body.feed_url).toMatch(
      /^https:\/\/app\.realtourflow\.com\/api\/calendar\/[a-f0-9]{48}\/feed\.ics$/,
    );

    // webcal_url is the feed_url with only the scheme swapped.
    expect(body.webcal_url).toBe(body.feed_url.replace(/^https:\/\//, "webcal://"));
  });

  it("keeps the legacy url/token keys for backward compatibility", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });

    const res = await calendarUrlRoute(await calendarUrlReq());
    const body = (await res.json()) as { url: string; token: string; feed_url: string };

    expect(body.url).toBe(body.feed_url);
    expect(body.token).toHaveLength(48);
  });

  it("swaps http:// to webcal:// for a non-TLS origin (local dev)", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });

    const res = await calendarUrlRoute(await calendarUrlReq("http://localhost:3000"));
    const body = (await res.json()) as { feed_url: string; webcal_url: string };

    expect(body.feed_url).toMatch(/^http:\/\/localhost:3000\//);
    expect(body.webcal_url).toMatch(/^webcal:\/\/localhost:3000\//);
  });
});

// ---------------------------------------------------------------------------
// POST /api/me/calendar-url/rotate — revoke + rotate the feed token (#297)
// ---------------------------------------------------------------------------

function calUrlReq(auth: string): Request {
  return new Request("http://localhost/api/me/calendar-url", {
    method: "GET",
    headers: { authorization: auth },
  });
}

function rotateReq(auth?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = auth;
  return new Request("http://localhost/api/me/calendar-url/rotate", {
    method: "POST",
    headers,
    body: "{}",
  });
}

// The feed route reads the token from ctx.params, not the URL path, so the
// path segment here is a placeholder.
function feedReq(): Request {
  return new Request("http://localhost/api/calendar/x/feed.ics");
}
function feedCtx(token: string) {
  return { params: Promise.resolve({ token }) };
}

async function currentToken(auth: string): Promise<string> {
  const res = (await calendarUrlRoute(calUrlReq(auth))) as Response;
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string };
  return body.token;
}

async function rotate(auth: string): Promise<{ status: number; token?: string }> {
  const res = (await rotateRoute(rotateReq(auth))) as Response;
  if (res.status !== 200) return { status: res.status };
  const body = (await res.json()) as { token: string };
  return { status: res.status, token: body.token };
}

async function feedStatus(token: string): Promise<number> {
  const res = (await feedRoute(feedReq(), feedCtx(token))) as Response;
  return res.status;
}

describe("POST /api/me/calendar-url/rotate (issue #297)", () => {
  it("case 1: rotate issues a new token and the old feed URL 404s immediately", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const auth = await authHeader("auth0|a", ["agent"]);

    // Lazily seed the initial token, and confirm its feed works.
    const oldToken = await currentToken(auth);
    expect(oldToken).toBeTruthy();
    expect(await feedStatus(oldToken)).toBe(200);

    const rot = await rotate(auth);
    expect(rot.status).toBe(200);
    expect(rot.token).toBeTruthy();
    expect(rot.token).not.toBe(oldToken);

    // Old link is dead; new link is live.
    expect(await feedStatus(oldToken)).toBe(404);
    expect(await feedStatus(rot.token!)).toBe(200);

    // Persisted on the users row.
    const row = await prisma.users.findUnique({
      where: { id: agent.id },
      select: { calendar_token: true },
    });
    expect(row?.calendar_token).toBe(rot.token);
  });

  it("case 2: rotating twice invalidates each immediately-prior token", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const auth = await authHeader("auth0|a", ["agent"]);

    const t0 = await currentToken(auth);

    const r1 = await rotate(auth);
    expect(r1.token).not.toBe(t0);
    expect(await feedStatus(t0)).toBe(404); // original dead
    expect(await feedStatus(r1.token!)).toBe(200); // first rotation live

    const r2 = await rotate(auth);
    expect(r2.token).not.toBe(r1.token);
    expect(r2.token).not.toBe(t0);
    expect(await feedStatus(r1.token!)).toBe(404); // prior rotation now dead
    expect(await feedStatus(r2.token!)).toBe(200); // latest live
  });

  it("case 3: rotation requires the agent's own Auth0 session — unauthenticated is rejected and nothing changes", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const auth = await authHeader("auth0|a", ["agent"]);
    const oldToken = await currentToken(auth);

    // No Authorization header — the public feed URL must never rotate the token.
    const res = (await rotateRoute(rotateReq())) as Response;
    expect(res.status).toBe(401);

    // Token unchanged; the existing feed still works.
    const row = await prisma.users.findUnique({
      where: { id: agent.id },
      select: { calendar_token: true },
    });
    expect(row?.calendar_token).toBe(oldToken);
    expect(await feedStatus(oldToken)).toBe(200);
  });
});
