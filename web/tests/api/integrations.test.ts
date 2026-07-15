import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { GET as integrationsRoute } from "@/app/api/me/integrations/route";
import { GET as calendarUrlRoute } from "@/app/api/me/calendar-url/route";
import { GET as feedRoute } from "@/app/api/calendar/[token]/feed.ics/route";
import { DELETE as disconnectGoogleRoute } from "@/app/api/me/integrations/google-calendar/route";
import { GET as startRoute } from "@/app/api/me/integrations/google-calendar/start/route";
import { GET as callbackRoute } from "@/app/api/integrations/google-calendar/callback/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { resetEnvForTesting } from "@/lib/env";
import { setGoogleOAuthForTesting, type GoogleTokens } from "@/lib/google-oauth";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser, createDeal } from "../helpers/factories";

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
});

beforeEach(async () => {
  await truncateAll();
});

describe("GET /api/me/integrations", () => {
  it("returns connected=true for Google Calendar when a token row exists", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await prisma.oauth_tokens.create({
      data: {
        user_id: user.id,
        provider: "google_calendar",
        access_token: "stub",
        account_email: "user@gmail.com",
        expires_at: new Date(Date.now() + 1000 * 60 * 60),
      },
    });
    const req = new Request("http://localhost/api/me/integrations", {
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await integrationsRoute(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      google_calendar: { connected: boolean; account_email?: string };
    };
    expect(body.google_calendar.connected).toBe(true);
    expect(body.google_calendar.account_email).toBe("user@gmail.com");
  });

  it("reports all integrations with sensible defaults", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const req = new Request("http://localhost/api/me/integrations", {
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await integrationsRoute(req);
    const body = (await res.json()) as {
      arive: { scope: string };
      docusign: { scope: string };
      stripe: { scope: string };
      google_calendar: { scope: string; connected: boolean };
      microsoft_calendar: { scope: string; connected: boolean };
    };
    expect(body.arive.scope).toBe("platform");
    expect(body.google_calendar.scope).toBe("user");
    expect(body.google_calendar.connected).toBe(false);
    expect(body.microsoft_calendar.connected).toBe(false);
  });
});

describe("DELETE /api/me/integrations/google-calendar", () => {
  it("deletes the token row and clears the event map", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await prisma.oauth_tokens.create({
      data: {
        user_id: user.id,
        provider: "google_calendar",
        access_token: "x",
        expires_at: new Date(Date.now() + 1000 * 60 * 60),
      },
    });
    await prisma.calendar_event_map.create({
      data: {
        user_id: user.id,
        provider: "google_calendar",
        internal_uid: "close-1",
        external_event_id: "evt-1",
      },
    });
    const req = new Request(
      "http://localhost/api/me/integrations/google-calendar",
      {
        method: "DELETE",
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }
    );
    const res = await disconnectGoogleRoute(req);
    expect(res.status).toBe(200);
    const tokens = await prisma.oauth_tokens.count({
      where: { user_id: user.id },
    });
    const map = await prisma.calendar_event_map.count({
      where: { user_id: user.id },
    });
    expect(tokens).toBe(0);
    expect(map).toBe(0);
  });
});

describe("Calendar feed", () => {
  it("GET /me/calendar-url issues a token and returns a subscription URL", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const req = new Request("http://localhost/api/me/calendar-url", {
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await calendarUrlRoute(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; token: string };
    expect(body.url).toMatch(/\/api\/calendar\/[a-f0-9]{48}\/feed\.ics$/);
    expect(body.token.length).toBe(48);
  });

  it("GET /calendar/[token]/feed.ics serves valid iCal with task due dates", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: user.id, title: "Elm Street" });
    await prisma.users.update({
      where: { id: user.id },
      data: { calendar_token: "f".repeat(48) },
    });
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 7);
    await prisma.tasks.create({
      data: {
        deal_id: deal.id,
        title: "Send disclosures",
        status: "pending",
        due_date: tomorrow,
      },
    });
    const req = new Request(
      `http://localhost/api/calendar/${"f".repeat(48)}/feed.ics`
    );
    const res = await feedRoute(req, {
      params: Promise.resolve({ token: "f".repeat(48) }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/calendar/);
    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("Task: Send disclosures");
    expect(body).toContain("END:VCALENDAR");
  });

  it("returns 404 for an unknown calendar token", async () => {
    const req = new Request(`http://localhost/api/calendar/badtoken/feed.ics`);
    const res = await feedRoute(req, { params: Promise.resolve({ token: "badtoken" }) });
    expect(res.status).toBe(404);
  });
});

// ── #296: revoked/expired token surfaces needs_reconnect ────────────────────
// The integration must stop reporting a permanently-green "Connected" once the
// OAuth token's refresh path is dead, and clear that state on a fresh reconnect.
describe("GET /api/me/integrations — needs_reconnect (#296)", () => {
  async function fetchStatus(sub: string) {
    const res = await integrationsRoute(
      new Request("http://localhost/api/me/integrations", {
        headers: { authorization: await authHeader(sub, ["agent"]) },
      })
    );
    expect(res.status).toBe(200);
    return (await res.json()) as {
      google_calendar: { connected: boolean; needs_reconnect?: boolean };
    };
  }

  it("Case 1: an expired token with no refresh_token → connected:true, needs_reconnect:true", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await prisma.oauth_tokens.create({
      data: {
        user_id: user.id,
        provider: "google_calendar",
        access_token: "dead",
        refresh_token: null,
        account_email: "user@gmail.com",
        expires_at: new Date(Date.now() - 60_000), // already expired
      },
    });
    const body = await fetchStatus("auth0|a");
    expect(body.google_calendar.connected).toBe(true);
    expect(body.google_calendar.needs_reconnect).toBe(true);
  });

  it("Case 1b: a stored needs_reconnect flag surfaces even before expiry", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await prisma.oauth_tokens.create({
      data: {
        user_id: user.id,
        provider: "google_calendar",
        access_token: "x",
        refresh_token: "still-here", // present, but revoked server-side
        needs_reconnect: true, // a prior push already flagged it
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const body = await fetchStatus("auth0|a");
    expect(body.google_calendar.connected).toBe(true);
    expect(body.google_calendar.needs_reconnect).toBe(true);
  });

  it("Case 2: a healthy token → connected:true, needs_reconnect:false", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await prisma.oauth_tokens.create({
      data: {
        user_id: user.id,
        provider: "google_calendar",
        access_token: "good",
        refresh_token: "refresh",
        account_email: "user@gmail.com",
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const body = await fetchStatus("auth0|a");
    expect(body.google_calendar.connected).toBe(true);
    expect(body.google_calendar.needs_reconnect).toBe(false);
  });
});

// A fresh OAuth callback must clear a previously-set needs_reconnect flag. This
// drives the real Google start + callback routes (token exchange stubbed).
describe("Google callback resets needs_reconnect (#296)", () => {
  const CLIENT_ID = "test-google-client-id.apps.googleusercontent.com";
  const ENV_KEYS = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URL",
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.GOOGLE_OAUTH_CLIENT_ID = CLIENT_ID;
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-google-secret";
    process.env.GOOGLE_OAUTH_REDIRECT_URL =
      "http://localhost:3000/api/integrations/google-calendar/callback";
    resetEnvForTesting(); // env() memoizes; drop the stale (unconfigured) snapshot
  });
  afterAll(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetEnvForTesting();
  });
  afterEach(() => setGoogleOAuthForTesting(undefined));

  function cookiePair(setCookie: string): string {
    return setCookie.split(";")[0];
  }

  async function runStart(sub: string): Promise<{ cookie: string; state: string }> {
    const req = new Request(
      "http://localhost/api/me/integrations/google-calendar/start",
      { headers: { authorization: await authHeader(sub, ["agent"]) } }
    );
    const res = await startRoute(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authorize_url: string };
    const setCookie = res.headers.get("set-cookie") as string;
    const state = new URL(body.authorize_url).searchParams.get("state") as string;
    return { cookie: cookiePair(setCookie), state };
  }

  it("Case 3: completing the OAuth callback clears a previously-set needs_reconnect", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await prisma.oauth_tokens.create({
      data: {
        user_id: agent.id,
        provider: "google_calendar",
        access_token: "old",
        refresh_token: "old-refresh",
        account_email: "agent@gmail.com",
        needs_reconnect: true, // was flagged dead
        expires_at: new Date(Date.now() - 60_000),
      },
    });
    setGoogleOAuthForTesting({
      exchangeCode: async (): Promise<GoogleTokens> => ({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/calendar.events",
        account_email: "agent@gmail.com",
      }),
    });

    const { cookie, state } = await runStart("auth0|a");
    const res = await callbackRoute(
      new Request(
        `http://localhost/api/integrations/google-calendar/callback?code=fake-code&state=${encodeURIComponent(
          state
        )}`,
        { headers: { cookie } }
      )
    );
    expect(res.status).toBe(302);

    const row = await prisma.oauth_tokens.findFirst({
      where: { user_id: agent.id, provider: "google_calendar" },
    });
    expect(row?.needs_reconnect).toBe(false);
    expect(row?.access_token).toBe("new-access");

    const statusRes = await integrationsRoute(
      new Request("http://localhost/api/me/integrations", {
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      })
    );
    const body = (await statusRes.json()) as {
      google_calendar: { connected: boolean; needs_reconnect?: boolean };
    };
    expect(body.google_calendar.connected).toBe(true);
    expect(body.google_calendar.needs_reconnect).toBe(false);
  });
});
