import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DefaultAuth0Client, type FetchLike } from "@/lib/auth0";
import { resetEnvForTesting } from "@/lib/env";

// Exercise the REAL DefaultAuth0Client (public change-password + Management
// API) with an injected fetch — the route tests in tests/api/ inject a whole
// fake client and never touch this layer. Mirrors lib/arive.test.ts.

const ENV_KEYS = [
  "AUTH0_DOMAIN",
  "NEXT_PUBLIC_AUTH0_CLIENT_ID",
  "AUTH0_DB_CONNECTION",
  "AUTH0_MGMT_CLIENT_ID",
  "AUTH0_MGMT_CLIENT_SECRET",
] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.AUTH0_DOMAIN = "tenant.test.auth0.local";
  process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID = "spa-client-id";
  delete process.env.AUTH0_DB_CONNECTION; // exercise the default connection name
  process.env.AUTH0_MGMT_CLIENT_ID = "mgmt-client-id";
  process.env.AUTH0_MGMT_CLIENT_SECRET = "mgmt-client-secret";
  resetEnvForTesting();
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetEnvForTesting();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Call = { url: string; init?: RequestInit };

describe("DefaultAuth0Client.sendPasswordResetEmail", () => {
  it("POSTs the public dbconnections/change_password endpoint with client_id + email + connection", async () => {
    const calls: Call[] = [];
    const fakeFetch: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return new Response("We've just sent you an email to reset your password.", {
        status: 200,
      });
    };

    const client = new DefaultAuth0Client(fakeFetch);
    await client.sendPasswordResetEmail("agent@example.com");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://tenant.test.auth0.local/dbconnections/change_password"
    );
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      client_id: "spa-client-id",
      email: "agent@example.com",
      connection: "Username-Password-Authentication", // env default
    });
    // No Authorization header — this is Auth0's PUBLIC endpoint.
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it("throws on a non-2xx response (the route swallows this — never the caller's problem)", async () => {
    const fakeFetch: FetchLike = async () =>
      new Response("bad connection", { status: 400 });
    const client = new DefaultAuth0Client(fakeFetch);
    await expect(
      client.sendPasswordResetEmail("agent@example.com")
    ).rejects.toThrow(/400/);
  });
});

describe("DefaultAuth0Client management API", () => {
  it("getUser fetches a client-credentials token then reads email_verified", async () => {
    const calls: Call[] = [];
    const fakeFetch: FetchLike = async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({ access_token: "mgmt-tok", expires_in: 86400 });
      }
      if (url.includes("/api/v2/users/")) {
        return jsonResponse({ user_id: "auth0|abc", email_verified: false });
      }
      throw new Error(`unexpected url ${url}`);
    };

    const client = new DefaultAuth0Client(fakeFetch);
    const user = await client.getUser("auth0|abc");

    expect(user.email_verified).toBe(false);

    const tokenCall = calls.find((c) => c.url.endsWith("/oauth/token"));
    expect(tokenCall?.url).toBe("https://tenant.test.auth0.local/oauth/token");
    expect(JSON.parse(tokenCall?.init?.body as string)).toEqual({
      grant_type: "client_credentials",
      client_id: "mgmt-client-id",
      client_secret: "mgmt-client-secret",
      audience: "https://tenant.test.auth0.local/api/v2/",
    });

    const userCall = calls.find((c) => c.url.includes("/api/v2/users/"));
    // The auth0 user id is URL-encoded (auth0|abc → auth0%7Cabc).
    expect(userCall?.url).toBe(
      "https://tenant.test.auth0.local/api/v2/users/auth0%7Cabc"
    );
    const headers = userCall?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer mgmt-tok");
  });

  it("sendVerificationEmail POSTs /api/v2/jobs/verification-email with user_id + client_id", async () => {
    const calls: Call[] = [];
    const fakeFetch: FetchLike = async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({ access_token: "mgmt-tok", expires_in: 86400 });
      }
      return jsonResponse({ status: "pending", id: "job_1" }, 201);
    };

    const client = new DefaultAuth0Client(fakeFetch);
    await client.sendVerificationEmail("auth0|abc");

    const jobCall = calls.find((c) => c.url.includes("/jobs/verification-email"));
    expect(jobCall?.url).toBe(
      "https://tenant.test.auth0.local/api/v2/jobs/verification-email"
    );
    expect(jobCall?.init?.method).toBe("POST");
    expect(JSON.parse(jobCall?.init?.body as string)).toEqual({
      user_id: "auth0|abc",
      client_id: "spa-client-id",
    });
    const headers = jobCall?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer mgmt-tok");
  });

  it("caches the management token across calls until expiry", async () => {
    let tokenCalls = 0;
    const fakeFetch: FetchLike = async (url) => {
      if (url.endsWith("/oauth/token")) {
        tokenCalls += 1;
        return jsonResponse({ access_token: "mgmt-tok", expires_in: 86400 });
      }
      if (url.includes("/api/v2/users/")) {
        return jsonResponse({ email_verified: true });
      }
      return jsonResponse({ status: "pending" }, 201);
    };

    const client = new DefaultAuth0Client(fakeFetch);
    await client.getUser("auth0|a");
    await client.getUser("auth0|b");
    await client.sendVerificationEmail("auth0|a");

    expect(tokenCalls).toBe(1);
  });

  it("throws when the token endpoint fails", async () => {
    const fakeFetch: FetchLike = async () =>
      new Response("access_denied", { status: 401 });
    const client = new DefaultAuth0Client(fakeFetch);
    await expect(client.getUser("auth0|a")).rejects.toThrow(/401/);
  });

  it("throws on a non-2xx user response", async () => {
    const fakeFetch: FetchLike = async (url) => {
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({ access_token: "tok", expires_in: 3600 });
      }
      return new Response("not found", { status: 404 });
    };
    const client = new DefaultAuth0Client(fakeFetch);
    await expect(client.getUser("auth0|ghost")).rejects.toThrow(/404/);
  });

  it("managementEnabled reflects the M2M env credentials", () => {
    expect(new DefaultAuth0Client().managementEnabled()).toBe(true);

    process.env.AUTH0_MGMT_CLIENT_ID = "";
    resetEnvForTesting();
    expect(new DefaultAuth0Client().managementEnabled()).toBe(false);

    process.env.AUTH0_MGMT_CLIENT_ID = "mgmt-client-id";
    resetEnvForTesting();
  });
});
