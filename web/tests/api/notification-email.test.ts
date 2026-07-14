import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { POST as createMessageRoute } from "@/app/api/deals/[id]/messages/route";
import { POST as createDocumentRoute } from "@/app/api/deals/[id]/documents/route";
import { POST as createTaskRoute } from "@/app/api/deals/[id]/tasks/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setEmailForTesting } from "@/lib/email";
import { setStorageForTesting } from "@/lib/blob-storage";
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
  // Document confirm now verifies the uploaded blob before inserting (#276).
  // These are notification tests, not blob-existence tests, so install the
  // recording backend with a default size — every confirmed key resolves.
  setStorageForTesting()!.defaultSize = 1024;
});

afterEach(() => {
  // Reset the seams so a stub from one test never leaks into the next.
  setEmailForTesting(undefined);
  setStorageForTesting(false);
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
 * Minimal Resend-surface fake — records every send, or throws to simulate a
 * delivery failure. Mirrors the fake in invite-email.test.ts. Never touches the
 * real Resend API.
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

function jsonReq(path: string, sub: string, roles: string[], body: unknown) {
  return (async () =>
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader(sub, roles),
      },
      body: JSON.stringify(body),
    }))();
}

describe("FF1 — notification emails (Resend)", () => {
  it("1. client_thread message → emails the RECIPIENT (not the sender)", async () => {
    // Agent sends → the buyer client is emailed.
    const agent = await createUser({
      role: "agent",
      auth0_id: "auth0|agent",
      email: "agent@example.com",
    });
    const buyer = await createUser({
      role: "buyer",
      auth0_id: "auth0|buyer",
      email: "buyer@example.com",
    });
    const deal = await createDeal({ agent_id: agent.id, title: "123 Elm St" });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });

    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    const req = await jsonReq(
      `/api/deals/${deal.id}/messages`,
      "auth0|agent",
      ["agent"],
      { body: "Hi there, quick update" }
    );
    const res = await createMessageRoute(req, ctx(deal.id));
    expect(res.status).toBe(201);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("buyer@example.com");
    // Never the sender.
    expect(sent[0].to).not.toBe("agent@example.com");
    expect(sent[0].subject.toLowerCase()).toContain("message");
    // Links back to the deal.
    // Client recipient links to their own portal (not the agent-only route).
    expect(sent[0].html).toContain(`/buyer/${buyer.id}`);
  });

  it("1b. client_thread message from the CLIENT → emails the agent", async () => {
    const agent = await createUser({
      role: "agent",
      auth0_id: "auth0|agent",
      email: "agent@example.com",
    });
    const buyer = await createUser({
      role: "buyer",
      auth0_id: "auth0|buyer",
      email: "buyer@example.com",
    });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });

    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    const req = await jsonReq(
      `/api/deals/${deal.id}/messages`,
      "auth0|buyer",
      ["buyer"],
      { body: "Question about the offer" }
    );
    const res = await createMessageRoute(req, ctx(deal.id));
    expect(res.status).toBe(201);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("agent@example.com");
    expect(sent[0].to).not.toBe("buyer@example.com");
    // Agent recipient links to the agent deal route.
    expect(sent[0].html).toContain(`/agent/deals/${deal.id}`);
  });

  it("1c. internal-channel message → no email (clients are not on internal)", async () => {
    const agent = await createUser({
      role: "agent",
      auth0_id: "auth0|agent",
      email: "agent@example.com",
    });
    const buyer = await createUser({
      role: "buyer",
      auth0_id: "auth0|buyer",
      email: "buyer@example.com",
    });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });

    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    const req = await jsonReq(
      `/api/deals/${deal.id}/messages`,
      "auth0|agent",
      ["agent"],
      { channel: "internal", body: "TC note" }
    );
    const res = await createMessageRoute(req, ctx(deal.id));
    expect(res.status).toBe(201);
    expect(sent).toHaveLength(0);
  });

  it("2. document confirm → emails the deal's client (not the uploader)", async () => {
    const agent = await createUser({
      role: "agent",
      auth0_id: "auth0|agent",
      email: "agent@example.com",
    });
    const buyer = await createUser({
      role: "buyer",
      auth0_id: "auth0|buyer",
      email: "buyer@example.com",
    });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });

    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    const req = await jsonReq(
      `/api/deals/${deal.id}/documents`,
      "auth0|agent",
      ["agent"],
      { name: "Disclosures.pdf", s3_key: `deals/${deal.id}/1/disclosures.pdf` }
    );
    const res = await createDocumentRoute(req, ctx(deal.id));
    expect(res.status).toBe(201);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("buyer@example.com");
    expect(sent[0].to).not.toBe("agent@example.com");
    expect(sent[0].subject.toLowerCase()).toContain("document");
    // Client recipient links to their own portal (not the agent-only route).
    expect(sent[0].html).toContain(`/buyer/${buyer.id}`);
  });

  // #293 — a CLIENT uploading (the "please upload your pre-approval" reply)
  // must reach the deal's agent. On the common single-participant deal the old
  // recipient set (clients minus the uploader) was EMPTY → nobody was emailed
  // and the request-a-doc loop dead-ended silently.
  it("2b. CLIENT upload (sole participant) → emails the deal's agent (#293)", async () => {
    const agent = await createUser({
      role: "agent",
      auth0_id: "auth0|agent",
      email: "agent@example.com",
    });
    const buyer = await createUser({
      role: "buyer",
      auth0_id: "auth0|buyer",
      email: "buyer@example.com",
    });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });

    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    const req = await jsonReq(
      `/api/deals/${deal.id}/documents`,
      "auth0|buyer",
      ["buyer"],
      { name: "PreApproval.pdf", s3_key: `deals/${deal.id}/1/preapproval.pdf` }
    );
    const res = await createDocumentRoute(req, ctx(deal.id));
    expect(res.status).toBe(201);

    // The agent is notified — previously the recipient set was empty here.
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("agent@example.com");
    expect(sent[0].to).not.toBe("buyer@example.com");
    // Agent recipient links to the agent deal route (not a client portal).
    expect(sent[0].html).toContain(`/agent/deals/${deal.id}`);
  });

  // #293 guard — an AGENT's own upload must NOT self-notify; only the clients
  // hear about it (unchanged from before).
  it("2c. AGENT upload → only clients emailed, never the agent (no self-notify; #293)", async () => {
    const agent = await createUser({
      role: "agent",
      auth0_id: "auth0|agent",
      email: "agent@example.com",
    });
    const buyer1 = await createUser({
      role: "buyer",
      auth0_id: "auth0|buyer1",
      email: "buyer1@example.com",
    });
    const buyer2 = await createUser({
      role: "buyer",
      auth0_id: "auth0|buyer2",
      email: "buyer2@example.com",
    });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer1.id, role: "buyer" },
    });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer2.id, role: "buyer" },
    });

    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    const req = await jsonReq(
      `/api/deals/${deal.id}/documents`,
      "auth0|agent",
      ["agent"],
      { name: "Disclosures.pdf", s3_key: `deals/${deal.id}/1/disclosures.pdf` }
    );
    const res = await createDocumentRoute(req, ctx(deal.id));
    expect(res.status).toBe(201);

    const recipients = sent.map((e) => e.to);
    expect(recipients).toHaveLength(2);
    expect(recipients).toContain("buyer1@example.com");
    expect(recipients).toContain("buyer2@example.com");
    expect(recipients).not.toContain("agent@example.com");
  });

  // #293 — a CLIENT upload on a deal with a co-buyer must reach BOTH the
  // co-buyer AND the agent, and never the uploader, with no duplicate sends.
  it("2d. CLIENT upload with a co-buyer → co-buyer AND agent emailed, no dupes (#293)", async () => {
    const agent = await createUser({
      role: "agent",
      auth0_id: "auth0|agent",
      email: "agent@example.com",
    });
    const buyer1 = await createUser({
      role: "buyer",
      auth0_id: "auth0|buyer1",
      email: "buyer1@example.com",
    });
    const buyer2 = await createUser({
      role: "buyer",
      auth0_id: "auth0|buyer2",
      email: "buyer2@example.com",
    });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer1.id, role: "buyer" },
    });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer2.id, role: "buyer" },
    });

    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    // buyer1 uploads.
    const req = await jsonReq(
      `/api/deals/${deal.id}/documents`,
      "auth0|buyer1",
      ["buyer"],
      { name: "PreApproval.pdf", s3_key: `deals/${deal.id}/1/preapproval.pdf` }
    );
    const res = await createDocumentRoute(req, ctx(deal.id));
    expect(res.status).toBe(201);

    const recipients = sent.map((e) => e.to);
    // The co-buyer AND the agent — but never the uploader.
    expect(recipients).toHaveLength(2);
    expect(recipients).toContain("buyer2@example.com");
    expect(recipients).toContain("agent@example.com");
    expect(recipients).not.toContain("buyer1@example.com");
    // No address emailed twice.
    expect(new Set(recipients).size).toBe(recipients.length);
  });

  it("3. task created with an assignee → emails the assignee", async () => {
    const agent = await createUser({
      role: "agent",
      auth0_id: "auth0|agent",
      email: "agent@example.com",
    });
    const buyer = await createUser({
      role: "buyer",
      auth0_id: "auth0|buyer",
      email: "buyer@example.com",
    });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });

    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    const req = await jsonReq(
      `/api/deals/${deal.id}/tasks`,
      "auth0|agent",
      ["agent"],
      { title: "Upload pre-approval", assigned_to: buyer.id }
    );
    const res = await createTaskRoute(req, ctx(deal.id));
    expect(res.status).toBe(201);
    const task = (await res.json()) as { assigned_to: string | null };
    expect(task.assigned_to).toBe(buyer.id);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("buyer@example.com");
    expect(sent[0].subject.toLowerCase()).toContain("task");
  });

  it("3b. task created without an assignee → no email", async () => {
    const agent = await createUser({
      role: "agent",
      auth0_id: "auth0|agent",
      email: "agent@example.com",
    });
    const deal = await createDeal({ agent_id: agent.id });

    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    const req = await jsonReq(
      `/api/deals/${deal.id}/tasks`,
      "auth0|agent",
      ["agent"],
      { title: "Generic task, no assignee" }
    );
    const res = await createTaskRoute(req, ctx(deal.id));
    expect(res.status).toBe(201);
    expect(sent).toHaveLength(0);
  });

  it("3c. agent assigns a task to THEMSELVES → no email (never email the actor)", async () => {
    const agent = await createUser({
      role: "agent",
      auth0_id: "auth0|agent",
      email: "agent@example.com",
    });
    const deal = await createDeal({ agent_id: agent.id });

    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    const req = await jsonReq(
      `/api/deals/${deal.id}/tasks`,
      "auth0|agent",
      ["agent"],
      { title: "Self task", assigned_to: agent.id }
    );
    const res = await createTaskRoute(req, ctx(deal.id));
    expect(res.status).toBe(201);
    expect(sent).toHaveLength(0);
  });

  // PREFERENCE NOTE: user_settings has only a free-form JSONB `settings` column
  // with no email-notification preference field and no existing convention for
  // one. Per the ticket, with no pref column the behavior is DEFAULT-ON: emails
  // always send. This test asserts that default-on contract — a recipient with a
  // user_settings row still gets the email.
  it("4. recipient with a user_settings row still gets emailed (default-on; no opt-out column)", async () => {
    const agent = await createUser({
      role: "agent",
      auth0_id: "auth0|agent",
      email: "agent@example.com",
    });
    const buyer = await createUser({
      role: "buyer",
      auth0_id: "auth0|buyer",
      email: "buyer@example.com",
    });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });
    // A settings row exists but carries no email-notification opt-out field.
    await prisma.user_settings.create({
      data: { user_id: buyer.id, settings: { theme: "dark" } },
    });

    const { client, sent } = fakeEmail();
    setEmailForTesting(client);

    const req = await jsonReq(
      `/api/deals/${deal.id}/messages`,
      "auth0|agent",
      ["agent"],
      { body: "still on?" }
    );
    const res = await createMessageRoute(req, ctx(deal.id));
    expect(res.status).toBe(201);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("buyer@example.com");
  });

  describe("5. best-effort — a throwing email impl never breaks the mutation", () => {
    it("5a. message still returns 201 when the email send throws", async () => {
      const agent = await createUser({
        role: "agent",
        auth0_id: "auth0|agent",
        email: "agent@example.com",
      });
      const buyer = await createUser({
        role: "buyer",
        auth0_id: "auth0|buyer",
        email: "buyer@example.com",
      });
      const deal = await createDeal({ agent_id: agent.id });
      await prisma.deal_participants.create({
        data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
      });

      const { client } = fakeEmail({ throwOnSend: true });
      setEmailForTesting(client);

      const req = await jsonReq(
        `/api/deals/${deal.id}/messages`,
        "auth0|agent",
        ["agent"],
        { body: "boom?" }
      );
      const res = await createMessageRoute(req, ctx(deal.id));
      expect(res.status).toBe(201);
      // The message was still persisted.
      const count = await prisma.messages.count({ where: { deal_id: deal.id } });
      expect(count).toBe(1);
    });

    it("5b. document still returns 201 when the email send throws", async () => {
      const agent = await createUser({
        role: "agent",
        auth0_id: "auth0|agent",
        email: "agent@example.com",
      });
      const buyer = await createUser({
        role: "buyer",
        auth0_id: "auth0|buyer",
        email: "buyer@example.com",
      });
      const deal = await createDeal({ agent_id: agent.id });
      await prisma.deal_participants.create({
        data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
      });

      const { client } = fakeEmail({ throwOnSend: true });
      setEmailForTesting(client);

      const req = await jsonReq(
        `/api/deals/${deal.id}/documents`,
        "auth0|agent",
        ["agent"],
        { name: "x.pdf", s3_key: `deals/${deal.id}/1/x.pdf` }
      );
      const res = await createDocumentRoute(req, ctx(deal.id));
      expect(res.status).toBe(201);
      const count = await prisma.documents.count({
        where: { deal_id: deal.id },
      });
      expect(count).toBe(1);
    });

    it("5c. task still returns 201 when the email send throws", async () => {
      const agent = await createUser({
        role: "agent",
        auth0_id: "auth0|agent",
        email: "agent@example.com",
      });
      const buyer = await createUser({
        role: "buyer",
        auth0_id: "auth0|buyer",
        email: "buyer@example.com",
      });
      const deal = await createDeal({ agent_id: agent.id });
      await prisma.deal_participants.create({
        data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
      });

      const { client } = fakeEmail({ throwOnSend: true });
      setEmailForTesting(client);

      const req = await jsonReq(
        `/api/deals/${deal.id}/tasks`,
        "auth0|agent",
        ["agent"],
        { title: "assign + boom", assigned_to: buyer.id }
      );
      const res = await createTaskRoute(req, ctx(deal.id));
      expect(res.status).toBe(201);
      const count = await prisma.tasks.count({ where: { deal_id: deal.id } });
      expect(count).toBe(1);
    });
  });
});
