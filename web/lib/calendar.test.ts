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
  googleProvider,
  microsoftProvider,
  setCalendarHttpForTesting,
  type CalendarEvent,
  type CalendarHttp,
} from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { truncateAll } from "@/tests/helpers/db";
import { createUser } from "@/tests/helpers/factories";

const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const MS_EVENTS_URL = "https://graph.microsoft.com/v1.0/me/events";
const MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

const ENV_KEYS = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "MICROSOFT_OAUTH_CLIENT_ID",
  "MICROSOFT_OAUTH_CLIENT_SECRET",
  "MICROSOFT_OAUTH_TENANT",
] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-google-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-google-secret";
  process.env.MICROSOFT_OAUTH_CLIENT_ID = "test-ms-client-id";
  process.env.MICROSOFT_OAUTH_CLIENT_SECRET = "test-ms-secret";
  process.env.MICROSOFT_OAUTH_TENANT = "common";
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

afterEach(() => setCalendarHttpForTesting(undefined));
beforeEach(async () => {
  await truncateAll();
});

// --- helpers ------------------------------------------------------------

type Call = { url: string; method: string; bodyRaw?: string; auth?: string };

function makeHttp(
  handler: (url: string, method: string) => Response
): { http: CalendarHttp; calls: Call[] } {
  const calls: Call[] = [];
  const http: CalendarHttp = async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url,
      method: init?.method ?? "GET",
      bodyRaw: typeof init?.body === "string" ? init.body : undefined,
      auth: headers.authorization ?? headers.Authorization,
    });
    return handler(url, init?.method ?? "GET");
  };
  return { http, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sampleEvent(uid: string): CalendarEvent {
  return {
    internalUid: uid,
    summary: "Closing — Elm St",
    description: "RealTourFlow closing day for Elm St",
    location: "123 Elm St",
    start: new Date("2026-09-15T00:00:00Z"),
    end: new Date("2026-09-16T00:00:00Z"),
    allDay: true,
  };
}

const future = () => new Date(Date.now() + 60 * 60 * 1000);
const past = () => new Date(Date.now() - 60 * 1000);

type ConnectOpts = { access?: string; refresh?: string | null; expiresAt?: Date };

async function connect(userId: string, provider: string, opts: ConnectOpts = {}) {
  await prisma.oauth_tokens.create({
    data: {
      user_id: userId,
      provider,
      access_token: opts.access ?? "valid-token",
      refresh_token: opts.refresh === undefined ? "refresh-token" : opts.refresh,
      account_email: "agent@example.com",
      expires_at: opts.expiresAt ?? future(),
    },
  });
}

const connectGoogle = (userId: string, opts: ConnectOpts = {}) =>
  connect(userId, "google_calendar", opts);
const connectMicrosoft = (userId: string, opts: ConnectOpts = {}) =>
  connect(userId, "microsoft_calendar", opts);

// --- cases --------------------------------------------------------------

describe("googleProvider.upsert", () => {
  it("case 1: no prior map row → POSTs an all-day event and saves the mapping", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await connectGoogle(user.id);
    const { http, calls } = makeHttp(() => jsonResponse({ id: "gevt-1" }));
    setCalendarHttpForTesting(http);

    await googleProvider.upsert(user.id, sampleEvent("close-deal1"));

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(EVENTS_URL);
    expect(calls[0].auth).toBe("Bearer valid-token");
    const body = JSON.parse(calls[0].bodyRaw as string);
    expect(body.start).toEqual({ date: "2026-09-15" });
    expect(body.end).toEqual({ date: "2026-09-16" });
    expect(body.summary).toBe("Closing — Elm St");

    const map = await prisma.calendar_event_map.findFirst({
      where: { user_id: user.id, provider: "google_calendar", internal_uid: "close-deal1" },
    });
    expect(map?.external_event_id).toBe("gevt-1");
  });

  it("case 2: existing map row → PATCHes the mapped event", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await connectGoogle(user.id);
    await prisma.calendar_event_map.create({
      data: {
        user_id: user.id,
        provider: "google_calendar",
        internal_uid: "close-deal1",
        external_event_id: "evt-existing",
      },
    });
    const { http, calls } = makeHttp(() => jsonResponse({ id: "evt-existing" }));
    setCalendarHttpForTesting(http);

    await googleProvider.upsert(user.id, sampleEvent("close-deal1"));

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toBe(`${EVENTS_URL}/evt-existing`);
  });

  it("case 3: PATCH 404 → deletes the stale map row and retries as POST", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await connectGoogle(user.id);
    await prisma.calendar_event_map.create({
      data: {
        user_id: user.id,
        provider: "google_calendar",
        internal_uid: "close-deal1",
        external_event_id: "evt-gone",
      },
    });
    const { http, calls } = makeHttp((_url, method) =>
      method === "PATCH"
        ? jsonResponse({ error: "not found" }, 404)
        : jsonResponse({ id: "evt-new" })
    );
    setCalendarHttpForTesting(http);

    await googleProvider.upsert(user.id, sampleEvent("close-deal1"));

    expect(calls.map((c) => c.method)).toEqual(["PATCH", "POST"]);
    const map = await prisma.calendar_event_map.findFirst({
      where: { user_id: user.id, internal_uid: "close-deal1" },
    });
    expect(map?.external_event_id).toBe("evt-new");
  });

  it("case 4: no oauth_tokens row → zero HTTP calls (best-effort no-op)", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const { http, calls } = makeHttp(() => jsonResponse({ id: "x" }));
    setCalendarHttpForTesting(http);

    await googleProvider.upsert(user.id, sampleEvent("close-deal1"));

    expect(calls).toHaveLength(0);
  });

  it("case 5a: expired token + refresh_token → refreshes, persists, then writes with the new token", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await connectGoogle(user.id, { access: "old-token", refresh: "refresh-x", expiresAt: past() });
    const { http, calls } = makeHttp((url) =>
      url.endsWith("/token")
        ? jsonResponse({ access_token: "fresh-token", expires_in: 3600 })
        : jsonResponse({ id: "gevt-r" })
    );
    setCalendarHttpForTesting(http);

    await googleProvider.upsert(user.id, sampleEvent("close-deal1"));

    expect(calls.some((c) => c.url === TOKEN_URL)).toBe(true);
    const eventsCall = calls.find((c) => c.url.startsWith(EVENTS_URL));
    expect(eventsCall?.auth).toBe("Bearer fresh-token");

    const tok = await prisma.oauth_tokens.findUnique({
      where: { user_id_provider: { user_id: user.id, provider: "google_calendar" } },
    });
    expect(tok?.access_token).toBe("fresh-token");
  });

  it("case 5b: expired token + no refresh_token → no-op (zero HTTP calls)", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await connectGoogle(user.id, { access: "old-token", refresh: null, expiresAt: past() });
    const { http, calls } = makeHttp(() => jsonResponse({ id: "x" }));
    setCalendarHttpForTesting(http);

    await googleProvider.upsert(user.id, sampleEvent("close-deal1"));

    expect(calls).toHaveLength(0);
  });
});

describe("microsoftProvider.upsert", () => {
  it("case 1: no prior map row → POSTs a Graph event and saves the mapping", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await connectMicrosoft(user.id);
    const { http, calls } = makeHttp(() => jsonResponse({ id: "msevt-1" }));
    setCalendarHttpForTesting(http);

    await microsoftProvider.upsert(user.id, sampleEvent("close-deal1"));

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(MS_EVENTS_URL);
    expect(calls[0].auth).toBe("Bearer valid-token");
    const body = JSON.parse(calls[0].bodyRaw as string);
    expect(body.subject).toBe("Closing — Elm St");
    expect(body.isAllDay).toBe(true);
    // Microsoft all-day = midnight–midnight UTC.
    expect(body.start).toEqual({ dateTime: "2026-09-15T00:00:00", timeZone: "UTC" });
    expect(body.end).toEqual({ dateTime: "2026-09-16T00:00:00", timeZone: "UTC" });

    const map = await prisma.calendar_event_map.findFirst({
      where: { user_id: user.id, provider: "microsoft_calendar", internal_uid: "close-deal1" },
    });
    expect(map?.external_event_id).toBe("msevt-1");
  });

  it("case 2: existing map row → PATCHes the mapped event", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await connectMicrosoft(user.id);
    await prisma.calendar_event_map.create({
      data: {
        user_id: user.id,
        provider: "microsoft_calendar",
        internal_uid: "close-deal1",
        external_event_id: "msevt-existing",
      },
    });
    const { http, calls } = makeHttp(() => jsonResponse({ id: "msevt-existing" }));
    setCalendarHttpForTesting(http);

    await microsoftProvider.upsert(user.id, sampleEvent("close-deal1"));

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toBe(`${MS_EVENTS_URL}/msevt-existing`);
  });

  it("case 3: PATCH 404 → deletes the stale map row and retries as POST", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await connectMicrosoft(user.id);
    await prisma.calendar_event_map.create({
      data: {
        user_id: user.id,
        provider: "microsoft_calendar",
        internal_uid: "close-deal1",
        external_event_id: "msevt-gone",
      },
    });
    const { http, calls } = makeHttp((_url, method) =>
      method === "PATCH"
        ? jsonResponse({ error: "not found" }, 404)
        : jsonResponse({ id: "msevt-new" })
    );
    setCalendarHttpForTesting(http);

    await microsoftProvider.upsert(user.id, sampleEvent("close-deal1"));

    expect(calls.map((c) => c.method)).toEqual(["PATCH", "POST"]);
    const map = await prisma.calendar_event_map.findFirst({
      where: { user_id: user.id, provider: "microsoft_calendar", internal_uid: "close-deal1" },
    });
    expect(map?.external_event_id).toBe("msevt-new");
  });

  it("case 4: no microsoft token → zero HTTP calls", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await connectGoogle(user.id); // connected to Google only, not Microsoft
    const { http, calls } = makeHttp(() => jsonResponse({ id: "x" }));
    setCalendarHttpForTesting(http);

    await microsoftProvider.upsert(user.id, sampleEvent("close-deal1"));

    expect(calls).toHaveLength(0);
  });

  it("case 5a: expired token + refresh_token → refreshes, persists rotated token, then writes", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await connectMicrosoft(user.id, { access: "old", refresh: "ms-refresh", expiresAt: past() });
    const { http, calls } = makeHttp((url) =>
      url.startsWith("https://login.microsoftonline.com")
        ? jsonResponse({ access_token: "ms-fresh", refresh_token: "ms-rotated", expires_in: 3600 })
        : jsonResponse({ id: "msevt-r" })
    );
    setCalendarHttpForTesting(http);

    await microsoftProvider.upsert(user.id, sampleEvent("close-deal1"));

    expect(calls.some((c) => c.url === MS_TOKEN_URL)).toBe(true);
    const eventsCall = calls.find((c) => c.url.startsWith(MS_EVENTS_URL));
    expect(eventsCall?.auth).toBe("Bearer ms-fresh");

    const tok = await prisma.oauth_tokens.findUnique({
      where: { user_id_provider: { user_id: user.id, provider: "microsoft_calendar" } },
    });
    expect(tok?.access_token).toBe("ms-fresh");
    // Microsoft rotates the refresh token — the new one must be persisted.
    expect(tok?.refresh_token).toBe("ms-rotated");
  });

  it("case 5b: expired token + no refresh_token → no-op (zero HTTP calls)", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await connectMicrosoft(user.id, { access: "old", refresh: null, expiresAt: past() });
    const { http, calls } = makeHttp(() => jsonResponse({ id: "x" }));
    setCalendarHttpForTesting(http);

    await microsoftProvider.upsert(user.id, sampleEvent("close-deal1"));

    expect(calls).toHaveLength(0);
  });
});
