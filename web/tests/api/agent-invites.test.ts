import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { GET as listRoute, POST as createRoute } from "@/app/api/admin/agent-invites/route";
import { DELETE as deleteRoute } from "@/app/api/admin/agent-invites/[inviteId]/route";
import { GET as getByTokenRoute } from "@/app/api/agent-invites/[token]/route";
import { POST as claimRoute } from "@/app/api/agent-invites/[token]/claim/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setEmailForTesting } from "@/lib/email";
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

afterEach(() => {
  // Reset the seam so a stub from one test never leaks into the next.
  setEmailForTesting(undefined);
});

type SentEmail = {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
};

/**
 * Minimal Resend-surface fake. Mirrors fakeEmail in invite-email.test.ts —
 * records every send, or throws to simulate a delivery failure. Never touches
 * the real Resend API.
 */
function fakeEmail(opts: { throwOnSend?: boolean } = {}) {
  const sent: SentEmail[] = [];
  const client = {
    emails: {
      send: async (payload: SentEmail) => {
        if (opts.throwOnSend) throw new Error("resend boom");
        sent.push(payload);
        return { data: { id: "email_test_1" }, error: null };
      },
    },
  };
  return { client, sent };
}

function tokenCtx(token: string) {
  return { params: Promise.resolve({ token }) };
}

function inviteIdCtx(inviteId: string) {
  return { params: Promise.resolve({ inviteId }) };
}

async function createReq(sub: string, roles: string[], body: unknown) {
  return new Request("http://localhost/api/admin/agent-invites", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: await authHeader(sub, roles),
    },
    body: JSON.stringify(body),
  });
}

async function listReq(sub: string, roles: string[]) {
  return new Request("http://localhost/api/admin/agent-invites", {
    method: "GET",
    headers: { authorization: await authHeader(sub, roles) },
  });
}

async function deleteReq(inviteId: string, sub: string, roles: string[]) {
  return new Request(`http://localhost/api/admin/agent-invites/${inviteId}`, {
    method: "DELETE",
    headers: { authorization: await authHeader(sub, roles) },
  });
}

function getReq(token: string) {
  return new Request(`http://localhost/api/agent-invites/${token}`, {
    method: "GET",
  });
}

async function claimReq(token: string, sub: string, roles: string[], body: unknown) {
  return new Request(`http://localhost/api/agent-invites/${token}/claim`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: await authHeader(sub, roles),
    },
    body: JSON.stringify(body),
  });
}

/**
 * Seeds an agent_invites row, optionally overriding expires_at / claimed_at.
 * Returns id + the (string) token for use in token-keyed routes.
 */
async function seedInvite(
  invitedBy: string,
  opts: { email?: string; name?: string; expiresAt?: Date; claimedAt?: Date; claimedBy?: string } = {}
): Promise<{ id: string; token: string; email: string }> {
  const email = opts.email ?? "invitee@example.com";
  const rows = await prisma.$queryRaw<{ id: string; token: string; email: string }[]>`
    INSERT INTO agent_invites (email, name, invited_by, expires_at, claimed_at, claimed_by)
    VALUES (
      ${email},
      ${opts.name ?? ""},
      ${invitedBy}::uuid,
      ${opts.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)},
      ${opts.claimedAt ?? null},
      ${opts.claimedBy ?? null}
    )
    RETURNING id, token::text AS token, email
  `;
  return rows[0];
}

describe("POST /api/admin/agent-invites — create", () => {
  it("1. admin → 201, returns token, and emails an /agent-signup/ link", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    const req = await createReq("auth0|admin", ["admin"], {
      email: "newagent@example.com",
      name: "New Agent",
    });
    const res = await createRoute(req);
    expect(res.status).toBe(201);
    const inv = (await res.json()) as { token: string; email: string; claimed: boolean };
    expect(inv.token).toBeTruthy();
    expect(inv.email).toBe("newagent@example.com");
    expect(inv.claimed).toBe(false);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("newagent@example.com");
    expect(sent[0].subject).toContain("agent");
    expect(sent[0].html).toContain(`/agent-signup/${inv.token}`);
  });

  it("2. still returns 201 and persists when the email send throws", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const { client } = fakeEmail({ throwOnSend: true });
    setEmailForTesting(client);

    const req = await createReq("auth0|admin", ["admin"], {
      email: "newagent@example.com",
      name: "New Agent",
    });
    const res = await createRoute(req);
    expect(res.status).toBe(201);
    const count = await prisma.agent_invites.count({
      where: { email: "newagent@example.com" },
    });
    expect(count).toBe(1);
  });

  it("3. non-admin → 403 and no email sent", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    const req = await createReq("auth0|agent", ["agent"], {
      email: "x@example.com",
      name: "X",
    });
    const res = await createRoute(req);
    expect(res.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it("4. missing email → 400", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    const req = await createReq("auth0|admin", ["admin"], { name: "No Email" });
    const res = await createRoute(req);
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });
});

describe("GET /api/agent-invites/[token] — public validate", () => {
  it("5. returns invite shape for a valid token", async () => {
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const seeded = await seedInvite(admin.id, { email: "invitee@example.com", name: "Invitee" });

    const res = await getByTokenRoute(getReq(seeded.token), tokenCtx(seeded.token));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      email: string;
      name: string;
      token: string;
      claimed: boolean;
      expires_at: string;
    };
    expect(body.id).toBe(seeded.id);
    expect(body.email).toBe("invitee@example.com");
    expect(body.name).toBe("Invitee");
    expect(body.token).toBe(seeded.token);
    expect(body.claimed).toBe(false);
    expect(typeof body.expires_at).toBe("string");
  });

  it("6. unknown token → 404", async () => {
    const unknown = "00000000-0000-0000-0000-000000000000";
    const res = await getByTokenRoute(getReq(unknown), tokenCtx(unknown));
    expect(res.status).toBe(404);
  });

  it("7. expired (unclaimed) token → 410", async () => {
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const seeded = await seedInvite(admin.id, {
      expiresAt: new Date(Date.now() - 60 * 1000),
    });
    const res = await getByTokenRoute(getReq(seeded.token), tokenCtx(seeded.token));
    expect(res.status).toBe(410);
  });
});

describe("POST /api/agent-invites/[token]/claim — claim", () => {
  it("8. upserts an agent user, marks the invite claimed, returns the user", async () => {
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const seeded = await seedInvite(admin.id, { email: "invitee@example.com" });

    const req = await claimReq(seeded.token, "auth0|newagent", ["agent"], {
      email: "claimed@example.com",
      name: "Claimed Agent",
    });
    const res = await claimRoute(req, tokenCtx(seeded.token));
    expect(res.status).toBe(200);
    const user = (await res.json()) as { id: string; email: string; role: string };
    expect(user.email).toBe("claimed@example.com");
    expect(user.role).toBe("agent");

    const invite = await prisma.agent_invites.findUnique({
      where: { id: seeded.id },
      select: { claimed_at: true, claimed_by: true },
    });
    expect(invite?.claimed_at).not.toBeNull();
    expect(invite?.claimed_by).toBe(user.id);

    // The upserted user is persisted as an agent.
    const dbUser = await prisma.users.findUnique({
      where: { auth0_id: "auth0|newagent" },
      select: { role: true },
    });
    expect(dbUser?.role).toBe("agent");
  });

  it("9. falls back to the invited email when body omits it", async () => {
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const seeded = await seedInvite(admin.id, { email: "invited@example.com" });

    const req = await claimReq(seeded.token, "auth0|fallback", ["agent"], {});
    const res = await claimRoute(req, tokenCtx(seeded.token));
    expect(res.status).toBe(200);
    const user = (await res.json()) as { email: string };
    expect(user.email).toBe("invited@example.com");
  });

  it("10. already-claimed invite → 409", async () => {
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const claimer = await createUser({ role: "agent", auth0_id: "auth0|claimer" });
    const seeded = await seedInvite(admin.id, {
      claimedAt: new Date(),
      claimedBy: claimer.id,
    });

    const req = await claimReq(seeded.token, "auth0|newagent", ["agent"], {});
    const res = await claimRoute(req, tokenCtx(seeded.token));
    expect(res.status).toBe(409);
  });

  it("11. expired invite → 410", async () => {
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const seeded = await seedInvite(admin.id, {
      expiresAt: new Date(Date.now() - 60 * 1000),
    });

    const req = await claimReq(seeded.token, "auth0|newagent", ["agent"], {});
    const res = await claimRoute(req, tokenCtx(seeded.token));
    expect(res.status).toBe(410);
  });

  it("12. no auth → 401", async () => {
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const seeded = await seedInvite(admin.id);

    const req = new Request(
      `http://localhost/api/agent-invites/${seeded.token}/claim`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }
    );
    const res = await claimRoute(req, tokenCtx(seeded.token));
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/admin/agent-invites/[inviteId] — revoke", () => {
  it("13. admin deletes an unclaimed invite → {ok:true}", async () => {
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const seeded = await seedInvite(admin.id);

    const req = await deleteReq(seeded.id, "auth0|admin", ["admin"]);
    const res = await deleteRoute(req, inviteIdCtx(seeded.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const count = await prisma.agent_invites.count({ where: { id: seeded.id } });
    expect(count).toBe(0);
  });

  it("14. deleting a claimed invite → 404", async () => {
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const claimer = await createUser({ role: "agent", auth0_id: "auth0|claimer" });
    const seeded = await seedInvite(admin.id, {
      claimedAt: new Date(),
      claimedBy: claimer.id,
    });

    const req = await deleteReq(seeded.id, "auth0|admin", ["admin"]);
    const res = await deleteRoute(req, inviteIdCtx(seeded.id));
    expect(res.status).toBe(404);
  });

  it("15. non-admin delete → 403", async () => {
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin" });
    await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const seeded = await seedInvite(admin.id);

    const req = await deleteReq(seeded.id, "auth0|agent", ["agent"]);
    const res = await deleteRoute(req, inviteIdCtx(seeded.id));
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/agent-invites — list", () => {
  it("16. admin sees seeded invites (newest first)", async () => {
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin" });
    await seedInvite(admin.id, { email: "a@example.com" });
    await seedInvite(admin.id, { email: "b@example.com" });

    const res = await listRoute(await listReq("auth0|admin", ["admin"]));
    expect(res.status).toBe(200);
    const list = (await res.json()) as { email: string; claimed: boolean }[];
    expect(list).toHaveLength(2);
    const emails = list.map((r) => r.email).sort();
    expect(emails).toEqual(["a@example.com", "b@example.com"]);
  });

  it("17. non-admin list → 403", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const res = await listRoute(await listReq("auth0|agent", ["agent"]));
    expect(res.status).toBe(403);
  });
});
