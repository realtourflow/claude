import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  GET as getTcRoute,
  PUT as putTcRoute,
  DELETE as deleteTcRoute,
} from "@/app/api/me/tc/route";
import { GET as getAgentsRoute } from "@/app/api/me/agents/route";
import { GET as listDealsRoute } from "@/app/api/deals/route";
import { GET as listTasksRoute } from "@/app/api/tasks/route";
import { GET as getChecklistRoute } from "@/app/api/deals/[id]/checklist/route";
import { GET as getContingenciesRoute } from "@/app/api/deals/[id]/contingencies/route";
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

function req(method: string, body?: unknown, sub = "auth0|agent", roles = ["agent"]) {
  return async () =>
    new Request("http://localhost/api/me/tc", {
      method,
      headers: {
        "content-type": "application/json",
        authorization: await authHeader(sub, roles),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
}

describe("GET /api/me/tc", () => {
  it("404 when no TC set, then returns ApiTCInfo after PUT", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|agent" });

    // Before: no tc_contact → 404 (Go's "no tc assigned").
    const before = await getTcRoute(await req("GET")());
    expect(before.status).toBe(404);

    // Save a TC.
    const put = await putTcRoute(
      await req("PUT", { name: "Tina Coord", email: "TINA@tc.test", phone: "555-0100" })()
    );
    expect(put.status).toBe(200);

    // After: ApiTCInfo shape with lowercased email, null user_id (no platform TC).
    const after = await getTcRoute(await req("GET")());
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual({
      name: "Tina Coord",
      email: "tina@tc.test",
      phone: "555-0100",
      user_id: null,
    });
  });

  it("401 without a token", async () => {
    const res = await getTcRoute(new Request("http://localhost/api/me/tc"));
    expect(res.status).toBe(401);
  });

  it("404 when the JWT subject has no DB user", async () => {
    const res = await getTcRoute(
      new Request("http://localhost/api/me/tc", {
        headers: { authorization: await authHeader("auth0|ghost", ["agent"]) },
      })
    );
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/me/tc", () => {
  it("saves name/email/phone (read-back via prisma tc_contact) and returns ApiTCInfo", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent" });

    const res = await putTcRoute(
      await req("PUT", { name: "  Tina Coord  ", email: "  Tina@TC.test ", phone: "555-0100" })()
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "Tina Coord",
      email: "tina@tc.test",
      phone: "555-0100",
      user_id: null,
    });

    // tc_contact JSONB persisted with trimmed name + lowercased email.
    const row = await prisma.users.findUnique({
      where: { id: agent.id },
      select: { tc_contact: true, tc_user_id: true },
    });
    expect(row?.tc_contact).toEqual({
      name: "Tina Coord",
      email: "tina@tc.test",
      phone: "555-0100",
    });
    expect(row?.tc_user_id).toBeNull();
  });

  it("links tc_user_id when a role='tc' platform user matches the email", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const tcUser = await createUser({
      role: "tc",
      auth0_id: "auth0|tc",
      email: "linked@tc.test",
      name: "Linked TC",
    });

    const res = await putTcRoute(
      await req("PUT", { name: "Linked TC", email: "Linked@TC.test", phone: "555-0200" })()
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user_id: string | null };
    expect(body.user_id).toBe(tcUser.id);

    const row = await prisma.users.findUnique({
      where: { id: agent.id },
      select: { tc_user_id: true },
    });
    expect(row?.tc_user_id).toBe(tcUser.id);
  });

  it("400 when name or email missing", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|agent" });

    const noName = await putTcRoute(await req("PUT", { name: "", email: "x@tc.test" })());
    expect(noName.status).toBe(400);

    const noEmail = await putTcRoute(await req("PUT", { name: "Tina", email: "  " })());
    expect(noEmail.status).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await putTcRoute(
      new Request("http://localhost/api/me/tc", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Tina", email: "x@tc.test" }),
      })
    );
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/me/tc", () => {
  it("clears tc_contact and tc_user_id; returns 204; subsequent GET is 404", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const tcUser = await createUser({
      role: "tc",
      auth0_id: "auth0|tc",
      email: "linked@tc.test",
    });

    // Seed an assigned + linked TC.
    await prisma.users.update({
      where: { id: agent.id },
      data: {
        tc_user_id: tcUser.id,
        tc_contact: { name: "Linked TC", email: "linked@tc.test", phone: "555-0200" },
      },
    });

    const del = await deleteTcRoute(await req("DELETE")());
    expect(del.status).toBe(204);

    const row = await prisma.users.findUnique({
      where: { id: agent.id },
      select: { tc_contact: true, tc_user_id: true },
    });
    expect(row?.tc_contact).toBeNull();
    expect(row?.tc_user_id).toBeNull();

    const after = await getTcRoute(await req("GET")());
    expect(after.status).toBe(404);
  });

  it("401 without a token", async () => {
    const res = await deleteTcRoute(
      new Request("http://localhost/api/me/tc", { method: "DELETE" })
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /api/me/agents", () => {
  it("returns agents who have the caller as their tc_user_id, with active_deal_count", async () => {
    const tc = await createUser({ role: "tc", auth0_id: "auth0|tc", name: "Coordinator" });

    // Two agents assigned to this TC, plus an unrelated agent that is NOT.
    const agentA = await createUser({ role: "agent", auth0_id: "auth0|a", name: "Agent Able" });
    const agentB = await createUser({ role: "agent", auth0_id: "auth0|b", name: "Agent Baker" });
    const unrelated = await createUser({ role: "agent", auth0_id: "auth0|u", name: "Agent Zed" });

    await prisma.users.updateMany({
      where: { id: { in: [agentA.id, agentB.id] } },
      data: { tc_user_id: tc.id },
    });

    // agentA: 2 open deals + 1 closed (post_close) → active_deal_count = 2.
    await createDeal({ agent_id: agentA.id, stage: "intake" });
    await createDeal({ agent_id: agentA.id, stage: "under_contract" });
    await createDeal({ agent_id: agentA.id, stage: "post_close" });
    // agentB: no deals → 0. unrelated: a deal that must not leak in.
    await createDeal({ agent_id: unrelated.id, stage: "intake" });

    const res = await getAgentsRoute(
      new Request("http://localhost/api/me/agents", {
        headers: { authorization: await authHeader("auth0|tc", ["tc"]) },
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      name: string;
      email: string;
      phone: string | null;
      active_deal_count: number;
    }[];

    // Only the two assigned agents, ordered by name; unrelated excluded.
    expect(body.map((a) => a.id)).toEqual([agentA.id, agentB.id]);
    const byId = Object.fromEntries(body.map((a) => [a.id, a]));
    expect(byId[agentA.id].active_deal_count).toBe(2);
    expect(byId[agentB.id].active_deal_count).toBe(0);
    expect(byId[agentA.id]).toMatchObject({ name: "Agent Able", email: agentA.email });
    expect(byId[agentA.id].phone).toBeNull();
  });

  it("returns [] when no agents are assigned to the caller", async () => {
    await createUser({ role: "tc", auth0_id: "auth0|tc" });
    const res = await getAgentsRoute(
      new Request("http://localhost/api/me/agents", {
        headers: { authorization: await authHeader("auth0|tc", ["tc"]) },
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("401 without a token", async () => {
    const res = await getAgentsRoute(new Request("http://localhost/api/me/agents"));
    expect(res.status).toBe(401);
  });

  it("404 when the JWT subject has no DB user", async () => {
    const res = await getAgentsRoute(
      new Request("http://localhost/api/me/agents", {
        headers: { authorization: await authHeader("auth0|ghost", ["tc"]) },
      })
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// #172 — TC cross-tenant scoping. A TC must only see data for agents who have
// linked them (users.tc_user_id = tc.id). Admins remain global.
// ---------------------------------------------------------------------------

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

/**
 * Seeds: TC-A linked to Agent-A (tc_user_id), Agent-B unlinked.
 * Each agent has one deal with one task.
 */
async function seedTwoTenants() {
  const tcA = await createUser({ role: "tc", auth0_id: "auth0|tc-a", name: "TC Able" });
  const agentA = await createUser({ role: "agent", auth0_id: "auth0|agent-a" });
  const agentB = await createUser({ role: "agent", auth0_id: "auth0|agent-b" });
  await prisma.users.update({
    where: { id: agentA.id },
    data: { tc_user_id: tcA.id },
  });
  const dealA = await createDeal({ agent_id: agentA.id, title: "Agent A Deal" });
  const dealB = await createDeal({ agent_id: agentB.id, title: "Agent B Deal" });
  await createTask({ deal_id: dealA.id, title: "Task A" });
  await createTask({ deal_id: dealB.id, title: "Task B" });
  return { tcA, agentA, agentB, dealA, dealB };
}

describe("TC cross-tenant scoping (#172) — GET /api/deals", () => {
  it("TC sees only linked agents' deals; unlinked agent's deal is ABSENT", async () => {
    const { dealA, dealB } = await seedTwoTenants();

    const res = await listDealsRoute(
      new Request("http://localhost/api/deals", {
        headers: { authorization: await authHeader("auth0|tc-a", ["tc"]) },
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; title: string }[];
    const ids = body.map((d) => d.id);
    expect(ids).toContain(dealA.id);
    expect(ids).not.toContain(dealB.id);
    expect(body.length).toBe(1);
  });

  it("a TC linked by no agents sees zero deals", async () => {
    await seedTwoTenants();
    await createUser({ role: "tc", auth0_id: "auth0|tc-lonely" });

    const res = await listDealsRoute(
      new Request("http://localhost/api/deals", {
        headers: { authorization: await authHeader("auth0|tc-lonely", ["tc"]) },
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("admin still sees all deals", async () => {
    const { dealA, dealB } = await seedTwoTenants();
    await createUser({ role: "admin", auth0_id: "auth0|admin" });

    const res = await listDealsRoute(
      new Request("http://localhost/api/deals", {
        headers: { authorization: await authHeader("auth0|admin", ["admin"]) },
      })
    );
    expect(res.status).toBe(200);
    const ids = ((await res.json()) as { id: string }[]).map((d) => d.id);
    expect(ids).toContain(dealA.id);
    expect(ids).toContain(dealB.id);
  });
});

describe("TC cross-tenant scoping (#172) — GET /api/tasks", () => {
  it("TC sees only tasks on linked agents' deals", async () => {
    await seedTwoTenants();

    const res = await listTasksRoute(
      new Request("http://localhost/api/tasks", {
        headers: { authorization: await authHeader("auth0|tc-a", ["tc"]) },
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string }[];
    expect(body.map((t) => t.title)).toEqual(["Task A"]);
  });

  it("admin still sees all tasks", async () => {
    await seedTwoTenants();
    await createUser({ role: "admin", auth0_id: "auth0|admin" });

    const res = await listTasksRoute(
      new Request("http://localhost/api/tasks", {
        headers: { authorization: await authHeader("auth0|admin", ["admin"]) },
      })
    );
    expect(res.status).toBe(200);
    const titles = ((await res.json()) as { title: string }[]).map((t) => t.title);
    expect(titles).toContain("Task A");
    expect(titles).toContain("Task B");
  });
});

describe("TC cross-tenant scoping (#172) — checklist access", () => {
  it("TC can read the checklist of a linked agent's deal", async () => {
    const { dealA } = await seedTwoTenants();

    const res = await getChecklistRoute(
      new Request(`http://localhost/api/deals/${dealA.id}/checklist`, {
        headers: { authorization: await authHeader("auth0|tc-a", ["tc"]) },
      }),
      ctx(dealA.id)
    );
    expect(res.status).toBe(200);
  });

  it("TC gets 404 on an unlinked agent's checklist", async () => {
    const { dealB } = await seedTwoTenants();

    const res = await getChecklistRoute(
      new Request(`http://localhost/api/deals/${dealB.id}/checklist`, {
        headers: { authorization: await authHeader("auth0|tc-a", ["tc"]) },
      }),
      ctx(dealB.id)
    );
    expect(res.status).toBe(404);
  });

  it("admin still has checklist access to any deal", async () => {
    const { dealB } = await seedTwoTenants();
    await createUser({ role: "admin", auth0_id: "auth0|admin" });

    const res = await getChecklistRoute(
      new Request(`http://localhost/api/deals/${dealB.id}/checklist`, {
        headers: { authorization: await authHeader("auth0|admin", ["admin"]) },
      }),
      ctx(dealB.id)
    );
    expect(res.status).toBe(200);
  });
});

describe("TC cross-tenant scoping (#172) — contingency access", () => {
  it("TC can read contingencies of a linked agent's deal", async () => {
    const { dealA } = await seedTwoTenants();

    const res = await getContingenciesRoute(
      new Request(`http://localhost/api/deals/${dealA.id}/contingencies`, {
        headers: { authorization: await authHeader("auth0|tc-a", ["tc"]) },
      }),
      ctx(dealA.id)
    );
    expect(res.status).toBe(200);
  });

  it("TC gets 403 on an unlinked agent's contingencies", async () => {
    const { dealB } = await seedTwoTenants();

    const res = await getContingenciesRoute(
      new Request(`http://localhost/api/deals/${dealB.id}/contingencies`, {
        headers: { authorization: await authHeader("auth0|tc-a", ["tc"]) },
      }),
      ctx(dealB.id)
    );
    expect(res.status).toBe(403);
  });

  it("admin still has contingency access to any deal", async () => {
    const { dealB } = await seedTwoTenants();
    await createUser({ role: "admin", auth0_id: "auth0|admin" });

    const res = await getContingenciesRoute(
      new Request(`http://localhost/api/deals/${dealB.id}/contingencies`, {
        headers: { authorization: await authHeader("auth0|admin", ["admin"]) },
      }),
      ctx(dealB.id)
    );
    expect(res.status).toBe(200);
  });
});
