import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { GET as startRoute } from "@/app/api/me/integrations/google-calendar/start/route";
import { GET as callbackRoute } from "@/app/api/integrations/google-calendar/callback/route";
import { GET as integrationsRoute } from "@/app/api/me/integrations/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setGoogleOAuthForTesting, type GoogleTokens } from "@/lib/google-oauth";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/factories";

const CLIENT_ID = "test-google-client-id.apps.googleusercontent.com";
const ENV_KEYS = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URL",
] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.GOOGLE_OAUTH_CLIENT_ID = CLIENT_ID;
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-google-secret";
  process.env.GOOGLE_OAUTH_REDIRECT_URL =
    "http://localhost:3000/api/integrations/google-calendar/callback";
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
});

afterAll(() => {
  // Don't leak the configured-Google env into other test files.
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

afterEach(() => {
  setGoogleOAuthForTesting(undefined);
});

beforeEach(async () => {
  await truncateAll();
});

// --- helpers ------------------------------------------------------------

/** Set-Cookie → the bare `name=value` pair a browser would echo back. */
function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0];
}

/** Drives the real `start` route and returns the cookie + nonce it issued. */
async function runStart(
  sub: string
): Promise<{ cookie: string; state: string; authorizeUrl: string }> {
  const req = new Request(
    "http://localhost/api/me/integrations/google-calendar/start",
    { headers: { authorization: await authHeader(sub, ["agent"]) } }
  );
  const res = await startRoute(req);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { authorize_url: string };
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  const state = new URL(body.authorize_url).searchParams.get("state");
  expect(state).toBeTruthy();
  return {
    cookie: cookiePair(setCookie as string),
    state: state as string,
    authorizeUrl: body.authorize_url,
  };
}

async function runCallback(opts: {
  code: string;
  state: string;
  cookie?: string;
}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  const req = new Request(
    `http://localhost/api/integrations/google-calendar/callback?code=${encodeURIComponent(
      opts.code
    )}&state=${encodeURIComponent(opts.state)}`,
    { headers }
  );
  return callbackRoute(req);
}

function fakeExchange(tokens: Partial<GoogleTokens>) {
  setGoogleOAuthForTesting({
    exchangeCode: async (): Promise<GoogleTokens> => ({
      access_token: "access-default",
      refresh_token: "refresh-default",
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/calendar.events",
      account_email: "agent@gmail.com",
      ...tokens,
    }),
  });
}

// --- start --------------------------------------------------------------

describe("GET /api/me/integrations/google-calendar/start", () => {
  it("returns an authorize_url + state cookie for an authed agent", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const { authorizeUrl, cookie } = await runStart("auth0|a");

    const u = new URL(authorizeUrl);
    expect(u.host).toBe("accounts.google.com");
    expect(u.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(u.searchParams.get("scope")).toContain("calendar.events");
    expect(u.searchParams.get("state")).toBeTruthy();
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");

    expect(cookie).toContain("rtf_oauth_state=");
    // assert the full Set-Cookie attributes
    const req = new Request(
      "http://localhost/api/me/integrations/google-calendar/start",
      { headers: { authorization: await authHeader("auth0|a", ["agent"]) } }
    );
    const res = await startRoute(req);
    const setCookie = res.headers.get("set-cookie") as string;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Max-Age=600/i);
  });

  it("returns 401 when unauthenticated", async () => {
    const req = new Request(
      "http://localhost/api/me/integrations/google-calendar/start"
    );
    const res = await startRoute(req);
    expect(res.status).toBe(401);
  });
});

// --- callback -----------------------------------------------------------

describe("GET /api/integrations/google-calendar/callback", () => {
  it("rejects a missing state cookie with 400 (CSRF)", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const res = await runCallback({ code: "x", state: "some-nonce" });
    expect(res.status).toBe(400);
  });

  it("rejects a mismatched state with 400 (CSRF)", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const { cookie } = await runStart("auth0|a");
    const res = await runCallback({ code: "x", state: "not-the-nonce", cookie });
    expect(res.status).toBe(400);
  });

  it("happy path: exchanges code, upserts token row, redirects 302", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    fakeExchange({
      access_token: "access-123",
      refresh_token: "refresh-123",
      account_email: "agent@gmail.com",
    });

    const { cookie, state } = await runStart("auth0|a");
    const res = await runCallback({ code: "fake-code", state, cookie });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain(
      "/settings?integration=google_calendar&status=connected"
    );

    const row = await prisma.oauth_tokens.findFirst({
      where: { user_id: agent.id, provider: "google_calendar" },
    });
    expect(row?.access_token).toBe("access-123");
    expect(row?.refresh_token).toBe("refresh-123");
    expect(row?.account_email).toBe("agent@gmail.com");
  });

  it("reconnect: updates access_token but preserves the prior refresh_token when Google returns none", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await prisma.oauth_tokens.create({
      data: {
        user_id: agent.id,
        provider: "google_calendar",
        access_token: "old-access",
        refresh_token: "old-refresh",
        account_email: "agent@gmail.com",
        expires_at: new Date(Date.now() + 3_600_000),
      },
    });
    // Google omits the refresh token on re-consent → empty string from exchange.
    fakeExchange({
      access_token: "new-access",
      refresh_token: "",
      account_email: "agent@gmail.com",
    });

    const { cookie, state } = await runStart("auth0|a");
    const res = await runCallback({ code: "fake-code", state, cookie });
    expect(res.status).toBe(302);

    const row = await prisma.oauth_tokens.findFirst({
      where: { user_id: agent.id, provider: "google_calendar" },
    });
    expect(row?.access_token).toBe("new-access");
    expect(row?.refresh_token).toBe("old-refresh");
  });

  it("after a successful connect, /api/me/integrations reports connected=true", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    fakeExchange({ account_email: "agent@gmail.com" });

    const { cookie, state } = await runStart("auth0|a");
    await runCallback({ code: "fake-code", state, cookie });

    const res = await integrationsRoute(
      new Request("http://localhost/api/me/integrations", {
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      })
    );
    const body = (await res.json()) as {
      google_calendar: { connected: boolean; account_email?: string };
    };
    expect(body.google_calendar.connected).toBe(true);
    expect(body.google_calendar.account_email).toBe("agent@gmail.com");
  });
});
