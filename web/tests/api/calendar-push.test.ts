import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import { PATCH as stageRoute } from "@/app/api/deals/[id]/stage/route";
import { POST as createTaskRoute } from "@/app/api/deals/[id]/tasks/route";
import { PATCH as taskStatusRoute } from "@/app/api/tasks/[id]/status/route";
import { GET as feedRoute } from "@/app/api/calendar/[token]/feed.ics/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setCalendarHttpForTesting } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser, createDeal } from "../helpers/factories";

const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
});

afterEach(() => setCalendarHttpForTesting(undefined));
beforeEach(async () => {
  await truncateAll();
});

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function datedConnectedDeal() {
  const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
  const deal = await createDeal({ agent_id: agent.id, title: "Elm St" });
  await prisma.deals.update({
    where: { id: deal.id },
    data: { arive_key_dates: { estimatedFundingDate: "2026-09-15" } },
  });
  await prisma.oauth_tokens.create({
    data: {
      user_id: agent.id,
      provider: "google_calendar",
      access_token: "tok",
      refresh_token: "r",
      account_email: "agent@gmail.com",
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return { agent, deal };
}

function advanceReq(dealId: string) {
  return authHeader("auth0|a", ["agent"]).then(
    (auth) =>
      new Request(`http://localhost/api/deals/${dealId}/stage`, {
        method: "PATCH",
        headers: { authorization: auth, "content-type": "application/json" },
        body: JSON.stringify({ stage: "active_search" }),
      })
  );
}

describe("calendar push on stage advance", () => {
  it("case 6: advancing a dated, connected deal pushes exactly one Google event and returns 200", async () => {
    const { agent, deal } = await datedConnectedDeal();
    let posts = 0;
    setCalendarHttpForTesting(async (_url, init) => {
      if ((init?.method ?? "GET") === "POST") posts += 1;
      return new Response(JSON.stringify({ id: "gevt-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const res = await stageRoute(await advanceReq(deal.id), ctx(deal.id));

    expect(res.status).toBe(200);
    expect(posts).toBe(1);
    const map = await prisma.calendar_event_map.findFirst({
      where: { user_id: agent.id, internal_uid: `close-${deal.id}` },
    });
    expect(map?.external_event_id).toBe("gevt-1");
  });

  it("case 6: still returns 200 when the calendar push throws", async () => {
    const { deal } = await datedConnectedDeal();
    setCalendarHttpForTesting(async () => {
      throw new Error("google is down");
    });

    const res = await stageRoute(await advanceReq(deal.id), ctx(deal.id));

    expect(res.status).toBe(200);
    // The stage change itself still persisted.
    const row = await prisma.deals.findUnique({ where: { id: deal.id } });
    expect(row?.stage).toBe("active_search");
  });

  it("does not call the calendar when the agent has no Google token", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id, title: "No Connect" });
    await prisma.deals.update({
      where: { id: deal.id },
      data: { arive_key_dates: { estimatedFundingDate: "2026-09-15" } },
    });
    let calls = 0;
    setCalendarHttpForTesting(async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    });

    const res = await stageRoute(await advanceReq(deal.id), ctx(deal.id));

    expect(res.status).toBe(200);
    expect(calls).toBe(0);
  });
});

// ── T5a-2: task-due events + delete-on-clear ───────────────────────────────

type RecordedCall = { method: string; url: string };

function recorder(respond: (method: string, url: string) => Response): RecordedCall[] {
  const calls: RecordedCall[] = [];
  setCalendarHttpForTesting(async (url, init) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    return respond(method, url);
  });
  return calls;
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function connectedAgentDeal() {
  const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
  const deal = await createDeal({ agent_id: agent.id, title: "Maple Ave" });
  await prisma.oauth_tokens.create({
    data: {
      user_id: agent.id,
      provider: "google_calendar",
      access_token: "tok",
      refresh_token: "r",
      account_email: "agent@gmail.com",
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return { agent, deal };
}

async function createTask(dealId: string, body: Record<string, unknown>) {
  const req = new Request(`http://localhost/api/deals/${dealId}/tasks`, {
    method: "POST",
    headers: {
      authorization: await authHeader("auth0|a", ["agent"]),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return createTaskRoute(req, ctx(dealId));
}

async function setStatus(taskId: string, status: string) {
  const req = new Request(`http://localhost/api/tasks/${taskId}/status`, {
    method: "PATCH",
    headers: {
      authorization: await authHeader("auth0|a", ["agent"]),
      "content-type": "application/json",
    },
    body: JSON.stringify({ status }),
  });
  return taskStatusRoute(req, ctx(taskId));
}

describe("task-due events + delete-on-clear (T5a-2)", () => {
  it("case 1: creating a task with a due date POSTs a task event", async () => {
    const { agent, deal } = await connectedAgentDeal();
    const calls = recorder(() => jsonRes({ id: "gevt-task" }));

    const res = await createTask(deal.id, {
      title: "Send disclosures",
      due_date: "2026-09-20",
    });
    expect(res.status).toBe(201);
    const task = (await res.json()) as { id: string };

    expect(
      calls.filter((c) => c.method === "POST" && c.url === EVENTS_URL)
    ).toHaveLength(1);
    const map = await prisma.calendar_event_map.findFirst({
      where: { user_id: agent.id, internal_uid: `task-${task.id}` },
    });
    expect(map?.external_event_id).toBe("gevt-task");
  });

  it("case 2: updating the task PATCHes the same event", async () => {
    const { deal } = await connectedAgentDeal();
    recorder(() => jsonRes({ id: "gevt-task" }));
    const created = await createTask(deal.id, {
      title: "Send disclosures",
      due_date: "2026-09-20",
    });
    const task = (await created.json()) as { id: string };

    const calls = recorder(() => jsonRes({ id: "gevt-task" }));
    const res = await setStatus(task.id, "in_progress");
    expect(res.status).toBe(200);

    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.url).toBe(`${EVENTS_URL}/gevt-task`);
  });

  it("case 3: clearing the closing date deletes the event (idempotent)", async () => {
    const { agent, deal } = await connectedAgentDeal(); // deal has no arive_key_dates
    await prisma.calendar_event_map.create({
      data: {
        user_id: agent.id,
        provider: "google_calendar",
        internal_uid: `close-${deal.id}`,
        external_event_id: "close-evt-1",
      },
    });

    const calls = recorder(() => new Response(null, { status: 204 }));
    const res = await stageRoute(await advanceReq(deal.id), ctx(deal.id));
    expect(res.status).toBe(200);

    expect(
      calls.filter(
        (c) => c.method === "DELETE" && c.url === `${EVENTS_URL}/close-evt-1`
      )
    ).toHaveLength(1);
    const map = await prisma.calendar_event_map.findFirst({
      where: { internal_uid: `close-${deal.id}` },
    });
    expect(map).toBeNull();

    // A second clear is a no-op — the mapping is already gone.
    const calls2 = recorder(() => new Response(null, { status: 204 }));
    await stageRoute(await advanceReq(deal.id), ctx(deal.id));
    expect(calls2).toHaveLength(0);
  });

  it("case 4: creating a task with no due date makes zero calendar calls", async () => {
    const { deal } = await connectedAgentDeal();
    const calls = recorder(() => jsonRes({ id: "x" }));

    const res = await createTask(deal.id, { title: "No date task" });
    expect(res.status).toBe(201);
    expect(calls).toHaveLength(0);
  });

  it("completing a task deletes its event", async () => {
    const { agent, deal } = await connectedAgentDeal();
    recorder(() => jsonRes({ id: "gevt-task" }));
    const created = await createTask(deal.id, {
      title: "Inspection",
      due_date: "2026-09-20",
    });
    const task = (await created.json()) as { id: string };

    const calls = recorder(() => new Response(null, { status: 204 }));
    const res = await setStatus(task.id, "completed");
    expect(res.status).toBe(200);

    expect(
      calls.filter(
        (c) => c.method === "DELETE" && c.url === `${EVENTS_URL}/gevt-task`
      )
    ).toHaveLength(1);
    const map = await prisma.calendar_event_map.findFirst({
      where: { user_id: agent.id, internal_uid: `task-${task.id}` },
    });
    expect(map).toBeNull();
  });
});

// ── T5b: dual-provider fan-out ─────────────────────────────────────────────

const MS_EVENTS_URL = "https://graph.microsoft.com/v1.0/me/events";

describe("dual-provider fan-out (T5b)", () => {
  it("one trigger upserts to BOTH Google and Microsoft (one event each)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id, title: "Both Cals" });
    await prisma.deals.update({
      where: { id: deal.id },
      data: { arive_key_dates: { estimatedFundingDate: "2026-09-15" } },
    });
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    for (const provider of ["google_calendar", "microsoft_calendar"]) {
      await prisma.oauth_tokens.create({
        data: {
          user_id: agent.id,
          provider,
          access_token: "tok",
          refresh_token: "r",
          account_email: "agent@example.com",
          expires_at: expires,
        },
      });
    }

    const calls: { method: string; url: string }[] = [];
    setCalendarHttpForTesting(async (url, init) => {
      calls.push({ method: init?.method ?? "GET", url });
      const id = url.startsWith(MS_EVENTS_URL) ? "ms-evt" : "g-evt";
      return new Response(JSON.stringify({ id }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const res = await stageRoute(await advanceReq(deal.id), ctx(deal.id));
    expect(res.status).toBe(200);

    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts.some((c) => c.url === EVENTS_URL)).toBe(true);
    expect(posts.some((c) => c.url === MS_EVENTS_URL)).toBe(true);

    const gMap = await prisma.calendar_event_map.findFirst({
      where: { user_id: agent.id, provider: "google_calendar", internal_uid: `close-${deal.id}` },
    });
    const mMap = await prisma.calendar_event_map.findFirst({
      where: { user_id: agent.id, provider: "microsoft_calendar", internal_uid: `close-${deal.id}` },
    });
    expect(gMap?.external_event_id).toBe("g-evt");
    expect(mMap?.external_event_id).toBe("ms-evt");
  });
});

// ── #196: the iCal feed must read the same ARIVE key-date keys as the push ─

const FEED_TOKEN = "a".repeat(48);

describe("iCal feed closing dates (#196)", () => {
  async function agentWithKeyDates(
    keyDates: Record<string, string> | null
  ): Promise<{ agentId: string; dealId: string }> {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|feed" });
    const deal = await createDeal({ agent_id: agent.id, title: "Elm St" });
    if (keyDates) {
      await prisma.deals.update({
        where: { id: deal.id },
        data: { arive_key_dates: keyDates },
      });
    }
    await prisma.users.update({
      where: { id: agent.id },
      data: { calendar_token: FEED_TOKEN },
    });
    return { agentId: agent.id, dealId: deal.id };
  }

  async function fetchFeed(): Promise<string> {
    const req = new Request(
      `http://localhost/api/calendar/${FEED_TOKEN}/feed.ics`
    );
    const res = await feedRoute(req, {
      params: Promise.resolve({ token: FEED_TOKEN }),
    });
    expect(res.status).toBe(200);
    return res.text();
  }

  it("case 1: a deal with estimatedFundingDate emits a closing VEVENT", async () => {
    const { dealId } = await agentWithKeyDates({
      estimatedFundingDate: "2026-09-15",
    });

    const body = await fetchFeed();

    expect(body).toContain(`UID:close-${dealId}@realtourflow`);
    expect(body).toContain("SUMMARY:Closing: Elm St");
    expect(body).toContain("DTSTART;VALUE=DATE:20260915");
  });

  it("case 2: falls back to closingContingency when there is no funding date", async () => {
    const { dealId } = await agentWithKeyDates({
      closingContingency: "2026-10-01",
    });

    const body = await fetchFeed();

    expect(body).toContain(`UID:close-${dealId}@realtourflow`);
    expect(body).toContain("DTSTART;VALUE=DATE:20261001");
  });

  it("prefers estimatedFundingDate when both keys are present (matches push/serializer)", async () => {
    await agentWithKeyDates({
      estimatedFundingDate: "2026-09-15",
      closingContingency: "2026-10-01",
    });

    const body = await fetchFeed();

    expect(body).toContain("DTSTART;VALUE=DATE:20260915");
    expect(body).not.toContain("DTSTART;VALUE=DATE:20261001");
  });

  it("case 3: a deal with no key dates emits no closing event", async () => {
    await agentWithKeyDates(null);

    const body = await fetchFeed();

    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).not.toContain("UID:close-");
  });
});
