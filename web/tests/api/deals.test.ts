import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { GET as listDeals, POST as createDealRoute } from "@/app/api/deals/route";
import { GET as getDealRoute } from "@/app/api/deals/[id]/route";
import { PATCH as advanceStageRoute } from "@/app/api/deals/[id]/stage/route";
import { PATCH as notesRoute } from "@/app/api/deals/[id]/notes/route";
import { PATCH as commissionRoute } from "@/app/api/deals/[id]/commission/route";
import { PATCH as flagsRoute } from "@/app/api/deals/[id]/flags/route";
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

describe("GET /api/deals", () => {
  it("returns 401 without auth", async () => {
    const res = await listDeals(new Request("http://localhost/api/deals"));
    expect(res.status).toBe(401);
  });

  it("returns the agent's own deals", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent-1" });
    const other = await createUser({ role: "agent" });
    await createDeal({ agent_id: agent.id, title: "Mine" });
    await createDeal({ agent_id: other.id, title: "Not mine" });

    const req = new Request("http://localhost/api/deals", {
      headers: { authorization: await authHeader("auth0|agent-1", ["agent"]) },
    });
    const res = await listDeals(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string }[];
    expect(body.length).toBe(1);
    expect(body[0].title).toBe("Mine");
  });

  it("returns ALL deals for admin role", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin-1" });
    const agent = await createUser({ role: "agent" });
    await createDeal({ agent_id: agent.id, title: "Deal A" });
    await createDeal({ agent_id: agent.id, title: "Deal B" });

    const req = new Request("http://localhost/api/deals", {
      headers: { authorization: await authHeader("auth0|admin-1", ["admin"]) },
    });
    const res = await listDeals(req);
    const body = (await res.json()) as unknown[];
    expect(body.length).toBe(2);
  });

  it("returns only linked agents' deals for tc role (#172)", async () => {
    const tc = await createUser({ role: "tc", auth0_id: "auth0|tc-1" });
    const linkedAgent = await createUser({ role: "agent" });
    const otherAgent = await createUser({ role: "agent" });
    await prisma.users.update({
      where: { id: linkedAgent.id },
      data: { tc_user_id: tc.id },
    });
    await createDeal({ agent_id: linkedAgent.id, title: "Linked deal" });
    await createDeal({ agent_id: otherAgent.id, title: "Foreign deal" });

    const req = new Request("http://localhost/api/deals", {
      headers: { authorization: await authHeader("auth0|tc-1", ["tc"]) },
    });
    const res = await listDeals(req);
    const body = (await res.json()) as { title: string }[];
    expect(body.map((d) => d.title)).toEqual(["Linked deal"]);
  });

  it("returns 404 if user has not been synced yet", async () => {
    const req = new Request("http://localhost/api/deals", {
      headers: { authorization: await authHeader("auth0|never-synced", ["agent"]) },
    });
    const res = await listDeals(req);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/deals", () => {
  it("creates a buy deal and returns it with green health", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const req = new Request("http://localhost/api/deals", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ title: "123 Elm", type: "buy", price: 500000 }),
    });
    const res = await createDealRoute(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { title: string; stage: string; type: string; health: string };
    expect(body.title).toBe("123 Elm");
    expect(body.type).toBe("buy");
    expect(body.stage).toBe("intake");
    expect(body.health).toBe("green");
  });

  it("400 when type is invalid", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const req = new Request("http://localhost/api/deals", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ title: "x", type: "lease" }),
    });
    const res = await createDealRoute(req);
    expect(res.status).toBe(400);
  });

  it("400 when title is missing", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const req = new Request("http://localhost/api/deals", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ type: "buy" }),
    });
    const res = await createDealRoute(req);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/deals/[id]", () => {
  it("404 if not owner", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const other = await createUser({ role: "agent", auth0_id: "auth0|b" });
    const deal = await createDeal({ agent_id: other.id });
    void agent;
    const req = new Request(`http://localhost/api/deals/${deal.id}`, {
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await getDealRoute(req, ctx(deal.id));
    expect(res.status).toBe(404);
  });

  it("returns the deal with computed health", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const req = new Request(`http://localhost/api/deals/${deal.id}`, {
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await getDealRoute(req, ctx(deal.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; health: string };
    expect(body.id).toBe(deal.id);
    expect(body.health).toBe("green");
  });

  it("returns red health when deal has overdue tasks", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await createTask({
      deal_id: deal.id,
      status: "pending",
      due_date: yesterday,
    });
    const req = new Request(`http://localhost/api/deals/${deal.id}`, {
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await getDealRoute(req, ctx(deal.id));
    const body = (await res.json()) as { health: string };
    expect(body.health).toBe("red");
  });
});

describe("GET /api/deals/[id] — TC/admin/participant read access (#167)", () => {
  it("200 for a TC linked to the deal's owning agent", async () => {
    const tc = await createUser({ role: "tc", auth0_id: "auth0|tc-linked" });
    const agent = await createUser({ role: "agent" });
    await prisma.users.update({
      where: { id: agent.id },
      data: { tc_user_id: tc.id },
    });
    const deal = await createDeal({ agent_id: agent.id });

    const req = new Request(`http://localhost/api/deals/${deal.id}`, {
      headers: { authorization: await authHeader("auth0|tc-linked", ["tc"]) },
    });
    const res = await getDealRoute(req, ctx(deal.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; health: string };
    expect(body.id).toBe(deal.id);
    expect(body.health).toBe("green");
  });

  it("200 for admin on any deal", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin-1" });
    const agent = await createUser({ role: "agent" });
    const deal = await createDeal({ agent_id: agent.id });

    const req = new Request(`http://localhost/api/deals/${deal.id}`, {
      headers: { authorization: await authHeader("auth0|admin-1", ["admin"]) },
    });
    const res = await getDealRoute(req, ctx(deal.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(deal.id);
  });

  it("404 for a TC NOT linked to the deal's agent (no cross-tenant read)", async () => {
    await createUser({ role: "tc", auth0_id: "auth0|tc-unlinked" });
    const agent = await createUser({ role: "agent" });
    const deal = await createDeal({ agent_id: agent.id });

    const req = new Request(`http://localhost/api/deals/${deal.id}`, {
      headers: { authorization: await authHeader("auth0|tc-unlinked", ["tc"]) },
    });
    const res = await getDealRoute(req, ctx(deal.id));
    expect(res.status).toBe(404);
  });

  it("200 for a deal participant (buyer)", async () => {
    const agent = await createUser({ role: "agent" });
    const buyer = await createUser({ role: "buyer", auth0_id: "auth0|buyer-1" });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });

    const req = new Request(`http://localhost/api/deals/${deal.id}`, {
      headers: { authorization: await authHeader("auth0|buyer-1", ["buyer"]) },
    });
    const res = await getDealRoute(req, ctx(deal.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(deal.id);
  });
});

describe("PATCH /api/deals/[id]/stage", () => {
  it("advances the stage and writes deal_stage_history", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id, stage: "intake" });
    const req = new Request(`http://localhost/api/deals/${deal.id}/stage`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ stage: "active_search" }),
    });
    const res = await advanceStageRoute(req, ctx(deal.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { stage: string };
    expect(body.stage).toBe("active_search");

    const history = await prisma.deal_stage_history.findMany({
      where: { deal_id: deal.id },
    });
    expect(history.length).toBe(1);
    expect(history[0].from_stage).toBe("intake");
    expect(history[0].to_stage).toBe("active_search");
  });

  it("blocks on high-priority incomplete task without force flag", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id, stage: "intake" });
    await createTask({
      deal_id: deal.id,
      priority: "high",
      status: "pending",
      stage_context: "intake",
      title: "Critical thing",
    });
    const req = new Request(`http://localhost/api/deals/${deal.id}/stage`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ stage: "active_search" }),
    });
    const res = await advanceStageRoute(req, ctx(deal.id));
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      gate: boolean;
      blocking_tasks: { title: string }[];
    };
    expect(body.gate).toBe(true);
    expect(body.blocking_tasks[0].title).toBe("Critical thing");
  });

  it("force=true bypasses the gate", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id, stage: "intake" });
    await createTask({
      deal_id: deal.id,
      priority: "high",
      status: "pending",
      stage_context: "intake",
    });
    const req = new Request(`http://localhost/api/deals/${deal.id}/stage?force=true`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ stage: "active_search" }),
    });
    const res = await advanceStageRoute(req, ctx(deal.id));
    expect(res.status).toBe(200);
  });

  it("404 when not owner", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const other = await createUser({ role: "agent", auth0_id: "auth0|b" });
    const deal = await createDeal({ agent_id: other.id });
    void agent;
    const req = new Request(`http://localhost/api/deals/${deal.id}/stage`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ stage: "active_search" }),
    });
    const res = await advanceStageRoute(req, ctx(deal.id));
    expect(res.status).toBe(404);
  });

  it("404 for a linked TC — stage changes stay agent-only (#167 policy)", async () => {
    // Decided in #167: read access for a linked TC does NOT extend to
    // advancing/retreating the stage. Only the owning agent moves a deal.
    const tc = await createUser({ role: "tc", auth0_id: "auth0|tc-linked" });
    const agent = await createUser({ role: "agent" });
    await prisma.users.update({
      where: { id: agent.id },
      data: { tc_user_id: tc.id },
    });
    const deal = await createDeal({ agent_id: agent.id, stage: "intake" });
    const req = new Request(`http://localhost/api/deals/${deal.id}/stage`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|tc-linked", ["tc"]),
      },
      body: JSON.stringify({ stage: "active_search" }),
    });
    const res = await advanceStageRoute(req, ctx(deal.id));
    expect(res.status).toBe(404);
    const row = await prisma.deals.findUnique({ where: { id: deal.id } });
    expect(row?.stage).toBe("intake");
  });
});

describe("PATCH /api/deals/[id]/notes", () => {
  it("updates notes for the owning agent", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const req = new Request(`http://localhost/api/deals/${deal.id}/notes`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ notes: "internal note" }),
    });
    const res = await notesRoute(req, ctx(deal.id));
    expect(res.status).toBe(200);
    const row = await prisma.deals.findUnique({ where: { id: deal.id } });
    expect(row?.notes).toBe("internal note");
  });

  it("403 when agent does not own the deal", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const other = await createUser({ role: "agent", auth0_id: "auth0|b" });
    const deal = await createDeal({ agent_id: other.id });
    void agent;
    const req = new Request(`http://localhost/api/deals/${deal.id}/notes`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ notes: "x" }),
    });
    const res = await notesRoute(req, ctx(deal.id));
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/deals/[id]/commission", () => {
  it("sets commission_pct in [0, 20]", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const req = new Request(`http://localhost/api/deals/${deal.id}/commission`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ commission_pct: 2.5 }),
    });
    const res = await commissionRoute(req, ctx(deal.id));
    expect(res.status).toBe(200);
  });

  it("rejects values outside [0, 20]", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const req = new Request(`http://localhost/api/deals/${deal.id}/commission`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ commission_pct: 25 }),
    });
    const res = await commissionRoute(req, ctx(deal.id));
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/deals/[id]/flags", () => {
  it("toggles pre_approved and baa_signed", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const req = new Request(`http://localhost/api/deals/${deal.id}/flags`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ pre_approved: true, baa_signed: true }),
    });
    const res = await flagsRoute(req, ctx(deal.id));
    expect(res.status).toBe(200);
    const row = await prisma.deals.findUnique({ where: { id: deal.id } });
    expect(row?.pre_approved).toBe(true);
    expect(row?.baa_signed).toBe(true);
  });
});

