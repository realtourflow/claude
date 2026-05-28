import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { GET as listAllRoute } from "@/app/api/tasks/route";
import {
  GET as listByDealRoute,
  POST as createTaskRoute,
} from "@/app/api/deals/[id]/tasks/route";
import { PATCH as updateStatusRoute } from "@/app/api/tasks/[id]/status/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser, createDeal, createTask } from "../helpers/factories";

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

describe("GET /api/tasks", () => {
  it("returns 401 without auth", async () => {
    const res = await listAllRoute(new Request("http://localhost/api/tasks"));
    expect(res.status).toBe(401);
  });

  it("returns only the agent's own tasks", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const other = await createUser({ role: "agent" });
    const mineDeal = await createDeal({ agent_id: agent.id });
    const theirDeal = await createDeal({ agent_id: other.id });
    await createTask({ deal_id: mineDeal.id, title: "Mine" });
    await createTask({ deal_id: theirDeal.id, title: "Theirs" });

    const req = new Request("http://localhost/api/tasks", {
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await listAllRoute(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string }[];
    expect(body.length).toBe(1);
    expect(body[0].title).toBe("Mine");
  });

  it("returns ALL tasks for tc/admin role", async () => {
    const tc = await createUser({ role: "tc", auth0_id: "auth0|tc" });
    const agent = await createUser({ role: "agent" });
    const deal = await createDeal({ agent_id: agent.id });
    await createTask({ deal_id: deal.id, title: "T1" });
    await createTask({ deal_id: deal.id, title: "T2" });
    void tc;

    const req = new Request("http://localhost/api/tasks", {
      headers: { authorization: await authHeader("auth0|tc", ["tc"]) },
    });
    const res = await listAllRoute(req);
    const body = (await res.json()) as unknown[];
    expect(body.length).toBe(2);
  });
});

describe("GET /api/deals/[id]/tasks", () => {
  it("lists tasks for an owned deal in creation order", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    await createTask({ deal_id: deal.id, title: "first" });
    await createTask({ deal_id: deal.id, title: "second" });
    const req = new Request(`http://localhost/api/deals/${deal.id}/tasks`, {
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await listByDealRoute(req, ctx(deal.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string }[];
    expect(body.map((t) => t.title)).toEqual(["first", "second"]);
  });

  it("404 when the deal isn't owned by the caller", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const other = await createUser({ role: "agent", auth0_id: "auth0|b" });
    const deal = await createDeal({ agent_id: other.id });
    void agent;
    const req = new Request(`http://localhost/api/deals/${deal.id}/tasks`, {
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await listByDealRoute(req, ctx(deal.id));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/deals/[id]/tasks", () => {
  it("creates a task with defaults", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const req = new Request(`http://localhost/api/deals/${deal.id}/tasks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ title: "Send pre-approval" }),
    });
    const res = await createTaskRoute(req, ctx(deal.id));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      title: string;
      priority: string;
      source: string;
      role: string;
      status: string;
    };
    expect(body.title).toBe("Send pre-approval");
    expect(body.priority).toBe("medium");
    expect(body.source).toBe("manual");
    expect(body.role).toBe("agent");
    expect(body.status).toBe("pending");
  });

  it("400 when title is missing", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const req = new Request(`http://localhost/api/deals/${deal.id}/tasks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ priority: "high" }),
    });
    const res = await createTaskRoute(req, ctx(deal.id));
    expect(res.status).toBe(400);
  });

  it("404 when the deal isn't owned by the caller", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const other = await createUser({ role: "agent", auth0_id: "auth0|b" });
    const deal = await createDeal({ agent_id: other.id });
    void agent;
    const req = new Request(`http://localhost/api/deals/${deal.id}/tasks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ title: "x" }),
    });
    const res = await createTaskRoute(req, ctx(deal.id));
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/tasks/[id]/status", () => {
  it("updates status when the user owns the parent deal", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const task = await createTask({ deal_id: deal.id, status: "pending" });

    const req = new Request(`http://localhost/api/tasks/${task.id}/status`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ status: "completed" }),
    });
    const res = await updateStatusRoute(req, ctx(task.id));
    expect(res.status).toBe(200);
    const row = await prisma.tasks.findUnique({ where: { id: task.id } });
    expect(row?.status).toBe("completed");
  });

  it("400 on invalid status string", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const task = await createTask({ deal_id: deal.id });
    const req = new Request(`http://localhost/api/tasks/${task.id}/status`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ status: "garbage" }),
    });
    const res = await updateStatusRoute(req, ctx(task.id));
    expect(res.status).toBe(400);
  });

  it("404 when user doesn't own the parent deal", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const other = await createUser({ role: "agent", auth0_id: "auth0|b" });
    const deal = await createDeal({ agent_id: other.id });
    const task = await createTask({ deal_id: deal.id });
    void agent;
    const req = new Request(`http://localhost/api/tasks/${task.id}/status`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ status: "completed" }),
    });
    const res = await updateStatusRoute(req, ctx(task.id));
    expect(res.status).toBe(404);
  });
});
