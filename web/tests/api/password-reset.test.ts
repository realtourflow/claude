import { describe, it, expect, afterEach } from "vitest";
import { POST as passwordResetRoute } from "@/app/api/auth/password-reset/route";
import { setAuth0ForTesting, type Auth0Client } from "@/lib/auth0";

// The one body the route may ever return on POST success — identical whether
// the email exists, doesn't exist, or the Auth0 call blew up. Anything else
// would let an attacker probe which emails have accounts.
const GENERIC_BODY = {
  ok: true,
  message: "If an account exists, a reset email has been sent.",
};

afterEach(() => {
  setAuth0ForTesting(undefined);
});

// A fake Auth0 client that records calls and optionally throws. Injected via
// the setAuth0ForTesting seam — these tests never touch real Auth0.
function fakeAuth0(opts?: { resetError?: Error }) {
  const resetCalls: string[] = [];
  const client: Auth0Client = {
    managementEnabled: () => true,
    sendPasswordResetEmail: async (email) => {
      resetCalls.push(email);
      if (opts?.resetError) throw opts.resetError;
    },
    getUser: async () => {
      throw new Error("getUser must not be called by password-reset");
    },
    sendVerificationEmail: async () => {
      throw new Error("sendVerificationEmail must not be called by password-reset");
    },
  };
  return { client, resetCalls };
}

function postReset(body: unknown): Promise<Response> {
  return passwordResetRoute(
    new Request("http://localhost/api/auth/password-reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

describe("POST /api/auth/password-reset", () => {
  it("valid email → calls the Auth0 client exactly once and returns the generic 200", async () => {
    const { client, resetCalls } = fakeAuth0();
    setAuth0ForTesting(client);

    const res = await postReset({ email: "agent@example.com" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(GENERIC_BODY);
    expect(resetCalls).toEqual(["agent@example.com"]);
  });

  it("unknown email (Auth0 throws not-found) → still the generic 200, never leaks existence", async () => {
    const { client, resetCalls } = fakeAuth0({
      resetError: new Error("auth0: 400 user does not exist"),
    });
    setAuth0ForTesting(client);

    const res = await postReset({ email: "nobody@example.com" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(GENERIC_BODY);
    expect(resetCalls).toEqual(["nobody@example.com"]);
  });

  it("Auth0 network error → still the generic 200", async () => {
    const { client } = fakeAuth0({ resetError: new TypeError("fetch failed") });
    setAuth0ForTesting(client);

    const res = await postReset({ email: "agent@example.com" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(GENERIC_BODY);
  });

  it("missing email → 400 and the Auth0 client is never called", async () => {
    const { client, resetCalls } = fakeAuth0();
    setAuth0ForTesting(client);

    const res = await postReset({});

    expect(res.status).toBe(400);
    expect(resetCalls).toHaveLength(0);
  });

  it("garbage (non-email-shaped) input → 400 and the Auth0 client is never called", async () => {
    const { client, resetCalls } = fakeAuth0();
    setAuth0ForTesting(client);

    for (const bad of ["not-an-email", "a@b", "   ", 42, null]) {
      const res = await postReset({ email: bad });
      expect(res.status).toBe(400);
    }
    expect(resetCalls).toHaveLength(0);
  });

  it("malformed JSON body → 400", async () => {
    const { client, resetCalls } = fakeAuth0();
    setAuth0ForTesting(client);

    const res = await postReset("{not json");

    expect(res.status).toBe(400);
    expect(resetCalls).toHaveLength(0);
  });
});
