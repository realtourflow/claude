import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  GET as listRoute,
  POST as createRoute,
} from "@/app/api/deals/[id]/messages/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
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

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/deals/[id]/messages", () => {
  it("returns 401 without auth", async () => {
    const agent = await createUser({ role: "agent" });
    const deal = await createDeal({ agent_id: agent.id });
    const req = new Request(`http://localhost/api/deals/${deal.id}/messages`);
    const res = await listRoute(req, ctx(deal.id));
    expect(res.status).toBe(401);
  });

  it("returns 404 when user is not the agent or a participant", async () => {
    const agent = await createUser({ role: "agent" });
    const stranger = await createUser({
      role: "buyer",
      auth0_id: "auth0|stranger",
    });
    const deal = await createDeal({ agent_id: agent.id });
    void stranger;
    const req = new Request(`http://localhost/api/deals/${deal.id}/messages`, {
      headers: { authorization: await authHeader("auth0|stranger", ["buyer"]) },
    });
    const res = await listRoute(req, ctx(deal.id));
    expect(res.status).toBe(404);
  });

  it("returns client_thread messages for the agent", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.messages.create({
      data: {
        deal_id: deal.id,
        sender_id: agent.id,
        channel: "client_thread",
        body: "hello",
      },
    });
    const req = new Request(`http://localhost/api/deals/${deal.id}/messages`, {
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await listRoute(req, ctx(deal.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { body: string; sender_role: string }[];
    expect(body.length).toBe(1);
    expect(body[0].body).toBe("hello");
    expect(body[0].sender_role).toBe("agent");
  });

  it("403 when participant requests internal channel", async () => {
    const agent = await createUser({ role: "agent" });
    const buyer = await createUser({
      role: "buyer",
      auth0_id: "auth0|buyer",
    });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });
    const req = new Request(
      `http://localhost/api/deals/${deal.id}/messages?channel=internal`,
      { headers: { authorization: await authHeader("auth0|buyer", ["buyer"]) } }
    );
    const res = await listRoute(req, ctx(deal.id));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/deals/[id]/messages", () => {
  it("creates a client_thread message with sender info", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const req = new Request(`http://localhost/api/deals/${deal.id}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ body: "hello world" }),
    });
    const res = await createRoute(req, ctx(deal.id));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      body: string;
      channel: string;
      sender_name: string;
      sender_role: string;
    };
    expect(body.body).toBe("hello world");
    expect(body.channel).toBe("client_thread");
    expect(body.sender_role).toBe("agent");
  });

  it("400 when body is empty", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const req = new Request(`http://localhost/api/deals/${deal.id}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ body: "" }),
    });
    const res = await createRoute(req, ctx(deal.id));
    expect(res.status).toBe(400);
  });

  it("participant trying to post to internal is silently demoted to client_thread", async () => {
    const agent = await createUser({ role: "agent" });
    const buyer = await createUser({
      role: "buyer",
      auth0_id: "auth0|buyer",
    });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });
    const req = new Request(`http://localhost/api/deals/${deal.id}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|buyer", ["buyer"]),
      },
      body: JSON.stringify({ channel: "internal", body: "trying internal" }),
    });
    const res = await createRoute(req, ctx(deal.id));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { channel: string };
    expect(body.channel).toBe("client_thread");
  });
});
