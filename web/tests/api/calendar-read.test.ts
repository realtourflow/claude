/**
 * FF6 — Two-way calendar sync (read path).
 *
 * Exercises GET /api/me/calendar/events, which reads external events back from
 * the agent's connected calendar(s) using the stored oauth_tokens (refreshing
 * on expiry) and merges them across providers. The provider HTTP is faked via
 * setCalendarHttpForTesting — tests NEVER hit real Google / Microsoft.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { GET as calendarEventsRoute } from "@/app/api/me/calendar/events/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setCalendarHttpForTesting } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/factories";

const GOOGLE_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const MS_CALENDAR_VIEW_URL = "https://graph.microsoft.com/v1.0/me/calendarView";

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
});

afterEach(() => setCalendarHttpForTesting(undefined));
beforeEach(async () => {
  await truncateAll();
});

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function connectGoogle(userId: string, opts: { expired?: boolean; refresh_token?: string | null } = {}) {
  await prisma.oauth_tokens.create({
    data: {
      user_id: userId,
      provider: "google_calendar",
      access_token: "old-google-token",
      refresh_token: opts.refresh_token === undefined ? "google-refresh" : opts.refresh_token,
      account_email: "agent@gmail.com",
      expires_at: new Date(Date.now() + (opts.expired ? -60_000 : 60 * 60 * 1000)),
    },
  });
}

async function connectMicrosoft(userId: string) {
  await prisma.oauth_tokens.create({
    data: {
      user_id: userId,
      provider: "microsoft_calendar",
      access_token: "ms-token",
      refresh_token: "ms-refresh",
      account_email: "agent@outlook.com",
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
}

// A single Google timed event.
const GOOGLE_LIST = {
  items: [
    {
      id: "g-evt-1",
      summary: "Buyer showing",
      start: { dateTime: "2026-09-15T15:00:00Z" },
      end: { dateTime: "2026-09-15T16:00:00Z" },
    },
  ],
};

// A single Microsoft all-day event.
const MS_LIST = {
  value: [
    {
      id: "ms-evt-1",
      subject: "Team offsite",
      isAllDay: true,
      start: { dateTime: "2026-09-20T00:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-09-21T00:00:00.0000000", timeZone: "UTC" },
    },
  ],
};

async function eventsReq(query = "") {
  const auth = await authHeader("auth0|a", ["agent"]);
  return new Request(`http://localhost/api/me/calendar/events${query}`, {
    method: "GET",
    headers: { authorization: auth },
  });
}

describe("GET /api/me/calendar/events (FF6 read path)", () => {
  it("case 1: connected agent returns external events from the provider", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await connectGoogle(agent.id);

    setCalendarHttpForTesting(async (url, init) => {
      if ((init?.method ?? "GET") === "GET" && url.startsWith(GOOGLE_EVENTS_URL)) {
        return jsonRes(GOOGLE_LIST);
      }
      throw new Error(`unexpected call: ${init?.method} ${url}`);
    });

    const res = (await calendarEventsRoute(await eventsReq())) as Response;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<Record<string, unknown>> };
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      id: "g-evt-1",
      provider: "google_calendar",
      summary: "Buyer showing",
      allDay: false,
    });
  });

  it("case 2: expired token with refresh_token refreshes, persists, then reads", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await connectGoogle(agent.id, { expired: true });

    let refreshed = 0;
    let listed = 0;
    setCalendarHttpForTesting(async (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "POST" && url === GOOGLE_TOKEN_URL) {
        refreshed += 1;
        return jsonRes({ access_token: "fresh-google-token", expires_in: 3600 });
      }
      if (method === "GET" && url.startsWith(GOOGLE_EVENTS_URL)) {
        listed += 1;
        // The read must carry the refreshed token, not the stale one.
        expect(init?.headers).toMatchObject({ authorization: "Bearer fresh-google-token" });
        return jsonRes(GOOGLE_LIST);
      }
      throw new Error(`unexpected call: ${method} ${url}`);
    });

    const res = (await calendarEventsRoute(await eventsReq())) as Response;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    expect(refreshed).toBe(1);
    expect(listed).toBe(1);
    expect(body.events).toHaveLength(1);

    // New token persisted to oauth_tokens.
    const tok = await prisma.oauth_tokens.findUnique({
      where: { user_id_provider: { user_id: agent.id, provider: "google_calendar" } },
      select: { access_token: true },
    });
    expect(tok?.access_token).toBe("fresh-google-token");
  });

  it("case 3: no oauth_tokens row returns an empty list without error", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });

    let calls = 0;
    setCalendarHttpForTesting(async () => {
      calls += 1;
      return jsonRes({ items: [] });
    });

    const res = (await calendarEventsRoute(await eventsReq())) as Response;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    expect(body.events).toEqual([]);
    expect(calls).toBe(0); // no token → zero HTTP
  });

  it("case 4: both providers connected merges events from both", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await connectGoogle(agent.id);
    await connectMicrosoft(agent.id);

    setCalendarHttpForTesting(async (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url.startsWith(GOOGLE_EVENTS_URL)) return jsonRes(GOOGLE_LIST);
      if (method === "GET" && url.startsWith(MS_CALENDAR_VIEW_URL)) return jsonRes(MS_LIST);
      throw new Error(`unexpected call: ${method} ${url}`);
    });

    const res = (await calendarEventsRoute(await eventsReq())) as Response;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ id: string; provider: string; allDay: boolean }> };
    expect(body.events).toHaveLength(2);
    const byProvider = Object.fromEntries(body.events.map((e) => [e.provider, e]));
    expect(byProvider.google_calendar?.id).toBe("g-evt-1");
    expect(byProvider.microsoft_calendar?.id).toBe("ms-evt-1");
    expect(byProvider.microsoft_calendar?.allDay).toBe(true);
  });
});
