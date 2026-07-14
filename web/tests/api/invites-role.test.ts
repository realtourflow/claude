/**
 * /api/invites/role — the email→role lookup the Auth0 Post-Login Action calls
 * to resolve a user's (or an unclaimed invite's) role.
 *
 * Before #271 this route was unauthenticated — an oracle to enumerate which
 * emails have accounts and what role each holds, plus which emails have a
 * pending invite. It is now gated by a shared secret (INVITE_ROLE_SECRET) sent
 * in the `x-invite-role-token` header, mirroring the fail-closed shape of
 * /api/indexnow/notion: unset secret → 503, wrong/missing token → 401 with no
 * role disclosed, and the lookup itself is unchanged once past the gate.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { GET as roleGET } from "@/app/api/invites/role/route";
import { resetEnvForTesting } from "@/lib/env";
import { prisma } from "@/lib/db";
import { truncateAll } from "../helpers/db";
import { createUser, createDeal } from "../helpers/factories";

const TOKEN = "test-invite-role-secret";

function req(email?: string, token?: string): Request {
  const url = new URL("http://localhost/api/invites/role");
  if (email !== undefined) url.searchParams.set("email", email);
  const headers: Record<string, string> = {};
  if (token !== undefined) headers["x-invite-role-token"] = token;
  return new Request(url, { headers });
}

beforeAll(() => {
  process.env.INVITE_ROLE_SECRET = TOKEN;
  resetEnvForTesting();
});

afterAll(() => {
  // Don't leak the secret into other suites (env cache is per-process; vitest
  // runs test files sequentially in one worker — see vitest.config fileParallelism).
  delete process.env.INVITE_ROLE_SECRET;
  resetEnvForTesting();
});

beforeEach(async () => {
  await truncateAll();
});

describe("GET /api/invites/role — shared-secret gate", () => {
  it("1a. 401 with no token — and does NOT disclose the role", async () => {
    await createUser({ email: "known@example.com", role: "agent" });

    const res = await roleGET(req("known@example.com"));

    expect(res.status).toBe(401);
    // The oracle is closed: the account's role never appears in the response.
    expect(await res.text()).not.toContain("agent");
  });

  it("1b. 401 with a wrong token — and does NOT disclose the role", async () => {
    await createUser({ email: "known@example.com", role: "agent" });

    const res = await roleGET(req("known@example.com", "wrong-token"));

    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("agent");
  });

  it("1c. 503 when INVITE_ROLE_SECRET is unset — even with a token (fail closed)", async () => {
    process.env.INVITE_ROLE_SECRET = "";
    resetEnvForTesting();
    try {
      const res = await roleGET(req("known@example.com", TOKEN));
      expect(res.status).toBe(503);
    } finally {
      process.env.INVITE_ROLE_SECRET = TOKEN;
      resetEnvForTesting();
    }
  });

  it("2. correct token + existing user → returns that user's role", async () => {
    await createUser({ email: "seller@example.com", role: "seller" });

    const res = await roleGET(req("seller@example.com", TOKEN));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { role: string };
    expect(body.role).toBe("seller");
  });

  it("3a. correct token + only an unclaimed unexpired invite → returns the invite's role", async () => {
    const agent = await createUser({ role: "agent" });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_invites.create({
      data: {
        deal_id: deal.id,
        email: "invited@example.com",
        name: "Invited Person",
        role: "buyer",
        invited_by: agent.id,
      },
    });

    const res = await roleGET(req("invited@example.com", TOKEN));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { role: string };
    expect(body.role).toBe("buyer");
  });

  it('3b. correct token + unknown email → { role: "" }', async () => {
    const res = await roleGET(req("nobody@example.com", TOKEN));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { role: string };
    expect(body.role).toBe("");
  });
});
