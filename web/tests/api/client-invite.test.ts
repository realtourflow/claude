import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { POST as clientInviteRoute } from "@/app/api/me/client-invite/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setEmailForTesting } from "@/lib/email";
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
  it("1. emails the onboarding link and returns 200 {ok:true}", async () => {
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
    const out = (await res.json()) as { ok: boolean; inviteUrl: string };
    expect(out.ok).toBe(true);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("buyer@example.com");
    // The onboarding link carries the role + the resolved agent id.
    const expectedUrl = `/onboard/buyer?agent=${agent.id}`;
    expect(out.inviteUrl).toContain(expectedUrl);
    expect(sent[0].html).toContain(expectedUrl);
  });

  it("2. seller role builds a /onboard/seller link", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|seller-agent" });
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
    expect(out.inviteUrl).toContain(`/onboard/seller?agent=${agent.id}`);
    expect(sent).toHaveLength(1);
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
