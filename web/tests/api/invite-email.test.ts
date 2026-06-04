import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { POST as createInviteRoute } from "@/app/api/deals/[id]/invite/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setEmailForTesting, sendInviteEmail } from "@/lib/email";
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

afterEach(() => {
  // Reset the seam so a stub from one test never leaks into the next.
  setEmailForTesting(undefined);
});

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

type SentEmail = {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
};

/**
 * Minimal Resend-surface fake. Mirrors the `setStripeForTesting` stub shape in
 * stripe-arive.test.ts — records every send, or throws to simulate a delivery
 * failure. Never touches the real Resend API.
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

function inviteReq(dealId: string, sub: string, roles: string[], body: unknown) {
  return (async () =>
    new Request(`http://localhost/api/deals/${dealId}/invite`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader(sub, roles),
      },
      body: JSON.stringify(body),
    }))();
}

describe("POST /api/deals/[id]/invite — Resend email", () => {
  it("1. sends the invite email exactly once and returns 201", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const deal = await createDeal({ agent_id: agent.id, title: "123 Elm St" });
    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    const req = await inviteReq(deal.id, "auth0|agent", ["agent"], {
      email: "buyer@example.com",
      name: "Bob Buyer",
      role: "buyer",
    });
    const res = await createInviteRoute(req, ctx(deal.id));
    expect(res.status).toBe(201);
    const inv = (await res.json()) as { token: string };

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("buyer@example.com");
    // dealTitle surfaces in the email...
    expect(sent[0].subject).toContain("123 Elm St");
    // ...and the inviteUrl carries the returned token.
    expect(sent[0].html).toContain(`/invite/${inv.token}`);
  });

  it("2. still returns 201 and persists the invite when the email send throws", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const deal = await createDeal({ agent_id: agent.id });
    const { client } = fakeEmail({ throwOnSend: true });
    setEmailForTesting(client);

    const req = await inviteReq(deal.id, "auth0|agent", ["agent"], {
      email: "buyer@example.com",
      name: "Bob Buyer",
      role: "buyer",
    });
    const res = await createInviteRoute(req, ctx(deal.id));
    expect(res.status).toBe(201);

    const count = await prisma.deal_invites.count({
      where: { deal_id: deal.id },
    });
    expect(count).toBe(1);
  });

  it("3a. non-agent role → 403 and no email sent", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const deal = await createDeal({ agent_id: agent.id });
    await createUser({ role: "buyer", auth0_id: "auth0|buyer" });
    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    const req = await inviteReq(deal.id, "auth0|buyer", ["buyer"], {
      email: "x@example.com",
      name: "X",
      role: "buyer",
    });
    const res = await createInviteRoute(req, ctx(deal.id));
    expect(res.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it("3b. agent who is not the deal owner → 403 and no email sent", async () => {
    const owner = await createUser({ role: "agent", auth0_id: "auth0|owner" });
    const deal = await createDeal({ agent_id: owner.id });
    await createUser({ role: "agent", auth0_id: "auth0|other" });
    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    const req = await inviteReq(deal.id, "auth0|other", ["agent"], {
      email: "x@example.com",
      name: "X",
      role: "buyer",
    });
    const res = await createInviteRoute(req, ctx(deal.id));
    expect(res.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it("4. missing/invalid role in body → 400 and no email sent", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const deal = await createDeal({ agent_id: agent.id });
    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    const req = await inviteReq(deal.id, "auth0|agent", ["agent"], {
      email: "buyer@example.com",
      name: "Bob Buyer",
      // role omitted
    });
    const res = await createInviteRoute(req, ctx(deal.id));
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("5. sendInviteEmail throws when no fake and no RESEND_API_KEY (client() guard)", async () => {
    setEmailForTesting(undefined);
    await expect(
      sendInviteEmail({
        to: "x@example.com",
        name: "X",
        dealTitle: "Some Deal",
        inviteUrl: "http://localhost/invite/tok",
      })
    ).rejects.toThrow(/RESEND_API_KEY/);
  });
});
