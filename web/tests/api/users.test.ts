import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { POST as syncRoute } from "@/app/api/users/sync/route";
import { GET as listRoute } from "@/app/api/users/route";
import { PATCH as activateRoute } from "@/app/api/users/[id]/activate/route";
import { PATCH as deactivateRoute } from "@/app/api/users/[id]/deactivate/route";
import { GET as listDealsRoute } from "@/app/api/deals/route";
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

function makeRequest(
  url: string,
  init: RequestInit & { auth?: string } = {}
): Request {
  const headers = new Headers(init.headers);
  if (init.auth) headers.set("authorization", init.auth);
  return new Request(url, { ...init, headers });
}

async function syncBody(body: unknown): Promise<Request> {
  return new Request("http://localhost/api/users/sync", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: await authHeader("auth0|new-agent", ["agent"]),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/users/sync", () => {
  it("returns 401 without an Authorization header", async () => {
    const req = makeRequest("http://localhost/api/users/sync", {
      method: "POST",
      body: JSON.stringify({ email: "a@b.co", name: "A" }),
    });
    const res = await syncRoute(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid JSON body", async () => {
    const req = new Request("http://localhost/api/users/sync", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|x", ["agent"]),
      },
      body: "not json{",
    });
    const res = await syncRoute(req);
    expect(res.status).toBe(400);
  });

  it("creates a new user from JWT role + body", async () => {
    const req = await syncBody({ email: "agent@example.com", name: "Agent Smith" });
    const res = await syncRoute(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string; name: string; role: string };
    expect(body.email).toBe("agent@example.com");
    expect(body.name).toBe("Agent Smith");
    expect(body.role).toBe("agent");
  });

  it("preserves an existing manually-edited name on re-sync", async () => {
    // First sync writes Auth0-supplied name.
    await syncRoute(await syncBody({ email: "u@example.com", name: "Initial" }));
    // Agent edits their name in onboarding — simulate by updating directly.
    await prisma.users.update({
      where: { auth0_id: "auth0|new-agent" },
      data: { name: "Manually Edited" },
    });
    // Second sync (Auth0 sends a different name — e.g. email) must NOT clobber.
    const req2 = await syncBody({ email: "u@example.com", name: "u@example.com" });
    const res2 = await syncRoute(req2);
    expect(res2.status).toBe(200);
    const body = (await res2.json()) as { name: string };
    expect(body.name).toBe("Manually Edited");
  });

  it("returns 403 when JWT has no role and no pre-existing user", async () => {
    const { signToken } = await getTestSigner();
    const token = await signToken({ sub: "auth0|no-role" }); // no roles claim
    const req = new Request("http://localhost/api/users/sync", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email: "x@y.co", name: "X" }),
    });
    const res = await syncRoute(req);
    expect(res.status).toBe(403);
  });

  it("falls back to persisted role when JWT has no roles claim", async () => {
    await createUser({
      auth0_id: "auth0|invited",
      email: "inv@example.com",
      name: "",
      role: "agent",
    });
    const { signToken } = await getTestSigner();
    const token = await signToken({ sub: "auth0|invited" });
    const req = new Request("http://localhost/api/users/sync", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email: "inv@example.com", name: "Invited User" }),
    });
    const res = await syncRoute(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { role: string; name: string };
    expect(body.role).toBe("agent");
    expect(body.name).toBe("Invited User");
  });
});

describe("GET /api/users", () => {
  it("returns 401 without auth", async () => {
    const res = await listRoute(new Request("http://localhost/api/users"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    const req = new Request("http://localhost/api/users", {
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await listRoute(req);
    expect(res.status).toBe(403);
  });

  it("returns all users ordered by role (enum order) then name for admin", async () => {
    await createUser({ name: "Zelda Admin", role: "admin" });
    await createUser({ name: "Alice Agent", role: "agent" });
    await createUser({ name: "Bob Agent", role: "agent" });

    const req = new Request("http://localhost/api/users", {
      headers: { authorization: await authHeader("auth0|admin", ["admin"]) },
    });
    const res = await listRoute(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; role: string }[];
    expect(body.length).toBe(3);
    // Postgres sorts enums by declaration order — `agent` is declared before
    // `admin` in the user_role enum, so agents come first, alphabetical by name.
    expect(body[0].name).toBe("Alice Agent");
    expect(body[0].role).toBe("agent");
    expect(body[1].name).toBe("Bob Agent");
    expect(body[1].role).toBe("agent");
    expect(body[2].name).toBe("Zelda Admin");
    expect(body[2].role).toBe("admin");
  });
});

describe("PATCH /api/users/[id]/activate", () => {
  async function call(id: string, roles: string[] = ["admin"]) {
    const req = new Request(`http://localhost/api/users/${id}/activate`, {
      method: "PATCH",
      headers: { authorization: await authHeader("auth0|admin", roles) },
    });
    return activateRoute(req, { params: Promise.resolve({ id }) });
  }

  it("returns 401 without auth", async () => {
    const req = new Request("http://localhost/api/users/abc/activate", {
      method: "PATCH",
    });
    const res = await activateRoute(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    const u = await createUser({ role: "agent" });
    const res = await call(u.id, ["agent"]);
    expect(res.status).toBe(403);
  });

  it("clears deactivated_at on the target user", async () => {
    const u = await createUser({ role: "agent" });
    await prisma.users.update({
      where: { id: u.id },
      data: { deactivated_at: new Date() },
    });
    const res = await call(u.id);
    expect(res.status).toBe(200);
    const row = await prisma.users.findUnique({ where: { id: u.id } });
    expect(row?.deactivated_at).toBeNull();
  });

  it("returns 404 for unknown user id", async () => {
    const res = await call("00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/users/[id]/deactivate", () => {
  async function call(id: string, roles: string[] = ["admin"]) {
    const req = new Request(`http://localhost/api/users/${id}/deactivate`, {
      method: "PATCH",
      headers: { authorization: await authHeader("auth0|admin", roles) },
    });
    return deactivateRoute(req, { params: Promise.resolve({ id }) });
  }

  it("returns 401 without auth", async () => {
    const req = new Request("http://localhost/api/users/abc/deactivate", {
      method: "PATCH",
    });
    const res = await deactivateRoute(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    const u = await createUser({ role: "agent" });
    const res = await call(u.id, ["agent"]);
    expect(res.status).toBe(403);
  });

  it("sets deactivated_at on the target user", async () => {
    const u = await createUser({ role: "agent" });
    const res = await call(u.id);
    expect(res.status).toBe(200);
    const row = await prisma.users.findUnique({ where: { id: u.id } });
    expect(row?.deactivated_at).not.toBeNull();
  });

  it("returns 404 if the user is already deactivated", async () => {
    const u = await createUser({ role: "agent" });
    await prisma.users.update({
      where: { id: u.id },
      data: { deactivated_at: new Date() },
    });
    const res = await call(u.id);
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown user id", async () => {
    const res = await call("00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });
});

describe("deactivated user enforcement (#173)", () => {
  async function deactivate(userId: string): Promise<void> {
    await prisma.users.update({
      where: { id: userId },
      data: { deactivated_at: new Date() },
    });
  }

  async function syncAs(auth: string): Promise<Response> {
    return syncRoute(
      new Request("http://localhost/api/users/sync", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: auth },
        body: JSON.stringify({ email: "who@example.com", name: "Who" }),
      })
    );
  }

  it("returns 403 on a protected route once the user is deactivated", async () => {
    const u = await createUser({ auth0_id: "auth0|fired-agent", role: "agent" });
    const auth = await authHeader("auth0|fired-agent", ["agent"]);

    // Sanity: while active, the agent can list deals.
    const before = await listDealsRoute(
      makeRequest("http://localhost/api/deals", { auth })
    );
    expect(before.status).toBe(200);

    await deactivate(u.id);

    const after = await listDealsRoute(
      makeRequest("http://localhost/api/deals", { auth })
    );
    expect(after.status).toBe(403);
  });

  it("returns 403 on /api/users/sync for a deactivated user", async () => {
    const u = await createUser({ auth0_id: "auth0|fired-sync", role: "agent" });
    await deactivate(u.id);
    const res = await syncAs(await authHeader("auth0|fired-sync", ["agent"]));
    expect(res.status).toBe(403);
  });

  it("returns 403 even on routes that never call resolveUserId (GET /api/users)", async () => {
    const admin = await createUser({ auth0_id: "auth0|fired-admin", role: "admin" });
    await deactivate(admin.id);
    const res = await listRoute(
      makeRequest("http://localhost/api/users", {
        auth: await authHeader("auth0|fired-admin", ["admin"]),
      })
    );
    expect(res.status).toBe(403);
  });

  it("restores access after reactivation", async () => {
    const u = await createUser({ auth0_id: "auth0|rehired", role: "agent" });
    await deactivate(u.id);
    const auth = await authHeader("auth0|rehired", ["agent"]);

    // Blocked while deactivated.
    const blocked = await listDealsRoute(
      makeRequest("http://localhost/api/deals", { auth })
    );
    expect(blocked.status).toBe(403);

    // Admin reactivates through the real route.
    const adminAuth = await authHeader("auth0|admin", ["admin"]);
    const actRes = await activateRoute(
      makeRequest(`http://localhost/api/users/${u.id}/activate`, {
        method: "PATCH",
        auth: adminAuth,
      }),
      { params: Promise.resolve({ id: u.id }) }
    );
    expect(actRes.status).toBe(200);

    // Access restored on sync and on a protected route.
    const syncRes = await syncAs(auth);
    expect(syncRes.status).toBe(200);
    const deals = await listDealsRoute(
      makeRequest("http://localhost/api/deals", { auth })
    );
    expect(deals.status).toBe(200);
  });

  it("leaves active users unaffected", async () => {
    await createUser({ auth0_id: "auth0|still-here", role: "agent" });
    const auth = await authHeader("auth0|still-here", ["agent"]);
    const deals = await listDealsRoute(
      makeRequest("http://localhost/api/deals", { auth })
    );
    expect(deals.status).toBe(200);
    const syncRes = await syncAs(auth);
    expect(syncRes.status).toBe(200);
  });
});

describe("GET /api/users — market + brokerage (admin)", () => {
  it("returns market and brokerage so admin can wire board/brokerage forms", async () => {
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin" });
    void admin;
    const agent = await createUser({ role: "agent", auth0_id: "auth0|ag" });
    await prisma.users.update({
      where: { id: agent.id },
      data: { market: "BALDWIN_GULF_COAST", brokerage: "RE/MAX" },
    });
    const res = await listRoute(
      makeRequest("http://localhost/api/users", {
        auth: await authHeader("auth0|admin", ["admin"]),
      })
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string; market: string; brokerage: string }[];
    const row = rows.find((r) => r.id === agent.id);
    expect(row?.market).toBe("BALDWIN_GULF_COAST");
    expect(row?.brokerage).toBe("RE/MAX");
  });
});
