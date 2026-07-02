import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { POST as clientInviteRoute } from "@/app/api/me/client-invite/route";
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

afterAll(() => {
  // Reset the seam so a stub never leaks into other suites.
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

function inviteReq(sub: string, roles: string[], body: unknown) {
  return (async () =>
    new Request(`http://localhost/api/me/client-invite`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader(sub, roles),
      },
      body: JSON.stringify(body),
    }))();
}

describe("POST /api/me/client-invite — Resend email", () => {
  it("1. creates an agent-owned deal + claimable invite and emails the /invite/<token> link", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    const req = await inviteReq("auth0|agent", ["agent"], {
      email: "buyer@example.com",
      name: "Bob Buyer",
      role: "buyer",
    });
    const res = await clientInviteRoute(req);
    expect(res.status).toBe(200);
    const out = (await res.json()) as { ok: boolean; inviteUrl: string; dealId: string };
    expect(out.ok).toBe(true);
    // Account-first: the link points at the tokened /invite/<token> flow.
    expect(out.inviteUrl).toMatch(/\/invite\/[0-9a-f-]{36}$/i);

    // A deal_invites row was created, tied to a new deal the inviting agent owns.
    const invites = await prisma.$queryRaw<
      { email: string; role: string; deal_id: string; invited_by: string }[]
    >`SELECT email, role, deal_id, invited_by FROM deal_invites`;
    expect(invites).toHaveLength(1);
    expect(invites[0].email).toBe("buyer@example.com");
    expect(invites[0].role).toBe("buyer");
    expect(invites[0].invited_by).toBe(agent.id);

    const deals = await prisma.$queryRaw<
      { id: string; agent_id: string; type: string }[]
    >`SELECT id, agent_id, type::text AS type FROM deals`;
    expect(deals).toHaveLength(1);
    expect(deals[0].agent_id).toBe(agent.id);
    expect(deals[0].type).toBe("buy");
    expect(deals[0].id).toBe(invites[0].deal_id);
    expect(out.dealId).toBe(deals[0].id);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("buyer@example.com");
    expect(sent[0].html).toContain("/invite/");
  });

  it("2. seller role creates a 'sell' deal + invite", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|seller-agent" });
    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    const req = await inviteReq("auth0|seller-agent", ["agent"], {
      email: "seller@example.com",
      name: "Sam Seller",
      role: "seller",
    });
    const res = await clientInviteRoute(req);
    expect(res.status).toBe(200);
    const out = (await res.json()) as { inviteUrl: string };
    expect(out.inviteUrl).toMatch(/\/invite\/[0-9a-f-]{36}$/i);
    expect(sent).toHaveLength(1);

    const rows = await prisma.$queryRaw<{ type: string; role: string }[]>`
      SELECT d.type::text AS type, di.role
      FROM deal_invites di JOIN deals d ON d.id = di.deal_id
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("sell");
    expect(rows[0].role).toBe("seller");
  });

  it("3. admin role is allowed", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    const req = await inviteReq("auth0|admin", ["admin"], {
      email: "buyer@example.com",
      name: "Bob Buyer",
      role: "buyer",
    });
    const res = await clientInviteRoute(req);
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it("4. still returns 200 when the email send throws", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const { client } = fakeEmail({ throwOnSend: true });
    setEmailForTesting(client);

    const req = await inviteReq("auth0|agent", ["agent"], {
      email: "buyer@example.com",
      name: "Bob Buyer",
      role: "buyer",
    });
    const res = await clientInviteRoute(req);
    expect(res.status).toBe(200);
  });

  it("5. non-agent/admin role → 403 and no email sent", async () => {
    await createUser({ role: "buyer", auth0_id: "auth0|buyer" });
    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    const req = await inviteReq("auth0|buyer", ["buyer"], {
      email: "x@example.com",
      name: "X",
      role: "buyer",
    });
    const res = await clientInviteRoute(req);
    expect(res.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it("6. missing fields → 400 and no email sent", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    const req = await inviteReq("auth0|agent", ["agent"], {
      email: "buyer@example.com",
      name: "Bob Buyer",
      // role omitted
    });
    const res = await clientInviteRoute(req);
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });
});
