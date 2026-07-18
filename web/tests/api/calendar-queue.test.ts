/**
 * FF4 (#22) — durable calendar-push queue (pg-boss).
 *
 * Architecture under test: enqueue durable job → attempt inline immediately →
 * Vercel Cron sweeps failures via POST/GET /api/jobs/process.
 *
 * These tests run REAL pg-boss against the shared test Postgres (its `pgboss`
 * schema is separate from the app tables, so `truncateAll()` never touches it).
 * The provider edge is faked via `setCalendarHttpForTesting` — no real
 * Google/Microsoft calls.
 *
 * pg-boss lifecycle: `start()` is slow (~1-2s), so one boss is shared across
 * the file (started in beforeAll) and stopped in afterAll so vitest exits
 * cleanly. Queue rows are purged in beforeEach for isolation.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { GET as processGET, POST as processPOST } from "@/app/api/jobs/process/route";
import { setCalendarHttpForTesting } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { resetEnvForTesting } from "@/lib/env";
import { enqueuePushDealClosingEvent } from "@/lib/jobs";
import {
  CALENDAR_QUEUE,
  enqueueCalendarJob,
  getBoss,
  processCalendarJobs,
  stopBossForTesting,
  type CalendarJobPayload,
} from "@/lib/queue";
import { truncateAll } from "../helpers/db";
import { createUser, createDeal, createTask } from "../helpers/factories";

const G_EVENTS = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TEST_CRON_SECRET = "test-cron-secret";

beforeAll(async () => {
  process.env.CRON_SECRET = TEST_CRON_SECRET;
  resetEnvForTesting();
  // Start pg-boss once for the whole file (slow); tests share the instance.
  await getBoss();
});

afterAll(async () => {
  await stopBossForTesting();
  delete process.env.CRON_SECRET;
  resetEnvForTesting();
});

beforeEach(async () => {
  await truncateAll();
  // Queue isolation: pgboss.* lives outside truncateAll's table list.
  const boss = await getBoss();
  await boss.deleteAllJobs(CALENDAR_QUEUE);
});

afterEach(() => setCalendarHttpForTesting(undefined));

// ── helpers ────────────────────────────────────────────────────────────────

type Recorded = { method: string; url: string };

/** Installs a calendar HTTP fake and returns the recorded calls. */
function fakeCalendar(respond: (method: string, url: string) => Response): Recorded[] {
  const calls: Recorded[] = [];
  setCalendarHttpForTesting(async (url, init) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    return respond(method, url);
  });
  return calls;
}

function okJson(id: string): Response {
  return new Response(JSON.stringify({ id }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Agent with a Google token + a deal carrying an ARIVE closing date. */
async function seedConnectedDeal() {
  const agent = await createUser({ role: "agent" });
  const deal = await createDeal({ agent_id: agent.id, title: "Queue Test Deal" });
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

async function allJobs() {
  const boss = await getBoss();
  return boss.findJobs<CalendarJobPayload>(CALENDAR_QUEUE);
}

/** Jobs the sweep can still pick up (created / retry). */
async function runnableJobs() {
  return (await allJobs()).filter((j) => j.state === "created" || j.state === "retry");
}

function processReq(init: RequestInit = {}): Request {
  return new Request("http://localhost/api/jobs/process", init);
}

// ── 1. enqueue + inline attempt consumes the job on success ───────────────

describe("enqueue → inline attempt (mutation path)", () => {
  it("pushes inline and consumes the durable job on success", async () => {
    const { agent, deal } = await seedConnectedDeal();
    const calls = fakeCalendar(() => okJson("gevt-q1"));

    await enqueuePushDealClosingEvent(deal.id);

    // The inline attempt hit the provider edge and recorded the mapping.
    expect(calls.filter((c) => c.method === "POST" && c.url === G_EVENTS)).toHaveLength(1);
    const map = await prisma.calendar_event_map.findFirst({
      where: { user_id: agent.id, internal_uid: `close-${deal.id}` },
    });
    expect(map?.external_event_id).toBe("gevt-q1");

    // A durable job was recorded, then CONSUMED by the inline success — the
    // sweep must find nothing to re-push.
    const jobs = await allJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].state).toBe("completed");
    expect(jobs[0].data).toEqual({ kind: "deal-closing", id: deal.id });
    expect(await runnableJobs()).toHaveLength(0);
  });
});

// ── 2. inline failure → job stays queued → sweep drains it ────────────────

describe("inline failure → durable sweep", () => {
  it("swallows the inline failure, keeps the job queued, and the sweep retries it", async () => {
    const { agent, deal } = await seedConnectedDeal();
    fakeCalendar(() => new Response("google is down", { status: 500 }));

    // Mutation-path latency contract: the call resolves (never throws) even
    // though the provider is hard-down.
    await expect(enqueuePushDealClosingEvent(deal.id)).resolves.toBeUndefined();

    // Nothing was written, but the durable job survives for the sweep.
    expect(await prisma.calendar_event_map.count()).toBe(0);
    expect(await runnableJobs()).toHaveLength(1);

    // Provider heals → cron sweep drains the queue and the event lands.
    fakeCalendar(() => okJson("gevt-q2"));
    const counts = await processCalendarJobs({ limit: 25 });
    expect(counts).toEqual({ processed: 1, failed: 0 });

    const map = await prisma.calendar_event_map.findFirst({
      where: { user_id: agent.id, internal_uid: `close-${deal.id}` },
    });
    expect(map?.external_event_id).toBe("gevt-q2");
    expect(await runnableJobs()).toHaveLength(0);
  });

  it("sweep processes task-due jobs too", async () => {
    const { agent, deal } = await seedConnectedDeal();
    const task = await createTask({
      deal_id: deal.id,
      title: "Send disclosures",
      due_date: new Date("2026-09-20"),
    });
    await enqueueCalendarJob({ kind: "task-due", id: task.id });

    fakeCalendar(() => okJson("gevt-task-q"));
    const counts = await processCalendarJobs({ limit: 25 });
    expect(counts).toEqual({ processed: 1, failed: 0 });

    const map = await prisma.calendar_event_map.findFirst({
      where: { user_id: agent.id, internal_uid: `task-${task.id}` },
    });
    expect(map?.external_event_id).toBe("gevt-task-q");
  });
});

// ── 3. transient worker failure → retryable, later sweep succeeds ─────────

describe("worker retry policy", () => {
  it("marks a failing job retryable (not dead) and succeeds on a later sweep", async () => {
    const { agent, deal } = await seedConnectedDeal();
    // Drive the worker path directly (no inline attempt). retryDelay 0 so the
    // retried job is immediately fetchable instead of waiting out the backoff.
    await enqueueCalendarJob(
      { kind: "deal-closing", id: deal.id },
      { retryDelay: 0, retryBackoff: false }
    );

    fakeCalendar(() => new Response("transient", { status: 503 }));
    const first = await processCalendarJobs({ limit: 25 });
    expect(first).toEqual({ processed: 0, failed: 1 });

    // pg-boss put the job in retry state — durable, will be retried.
    const [job] = await allJobs();
    expect(job.state).toBe("retry");
    expect(job.retryLimit).toBeGreaterThanOrEqual(1);

    fakeCalendar(() => okJson("gevt-q3"));
    const second = await processCalendarJobs({ limit: 25 });
    expect(second).toEqual({ processed: 1, failed: 0 });

    const map = await prisma.calendar_event_map.findFirst({
      where: { user_id: agent.id, internal_uid: `close-${deal.id}` },
    });
    expect(map?.external_event_id).toBe("gevt-q3");
    expect(await runnableJobs()).toHaveLength(0);
  });

  it("default enqueue carries the retry policy (limit 8, backoff)", async () => {
    const { deal } = await seedConnectedDeal();
    await enqueueCalendarJob({ kind: "deal-closing", id: deal.id });

    const [job] = await allJobs();
    expect(job.retryLimit).toBe(8);
    expect(job.retryBackoff).toBe(true);
    expect(job.retryDelay).toBe(60);
  });
});

// ── 4. idempotency: same deal twice → one mapping, PATCH not POST ──────────

describe("idempotency across enqueue+process", () => {
  it("enqueue+process the same deal twice yields ONE mapping (PATCH, not duplicate create)", async () => {
    const { agent, deal } = await seedConnectedDeal();
    const calls = fakeCalendar(() => okJson("gevt-q4"));

    // Twice through the mutation path (inline attempts)...
    await enqueuePushDealClosingEvent(deal.id);
    await enqueuePushDealClosingEvent(deal.id);

    // ...and once more through the sweep for good measure.
    await enqueueCalendarJob({ kind: "deal-closing", id: deal.id });
    const counts = await processCalendarJobs({ limit: 25 });
    expect(counts).toEqual({ processed: 1, failed: 0 });

    // First call POSTs, every later one PATCHes the same external event.
    expect(calls.filter((c) => c.method === "POST" && c.url === G_EVENTS)).toHaveLength(1);
    expect(
      calls.filter((c) => c.method === "PATCH" && c.url === `${G_EVENTS}/gevt-q4`)
    ).toHaveLength(2);

    const maps = await prisma.calendar_event_map.findMany({
      where: { user_id: agent.id, internal_uid: `close-${deal.id}` },
    });
    expect(maps).toHaveLength(1);
    expect(maps[0].external_event_id).toBe("gevt-q4");
  });
});

// ── 5. /api/jobs/process route contract ────────────────────────────────────

describe("GET/POST /api/jobs/process (cron sweep route)", () => {
  it("401 without a bearer token (GET and POST)", async () => {
    expect((await processGET(processReq())).status).toBe(401);
    expect((await processPOST(processReq({ method: "POST" }))).status).toBe(401);
  });

  it("401 with the wrong bearer token", async () => {
    const res = await processGET(
      processReq({ headers: { authorization: "Bearer wrong-secret" } })
    );
    expect(res.status).toBe(401);
  });

  it("200 + counts shape with the right bearer (GET — what Vercel Cron sends)", async () => {
    const res = await processGET(
      processReq({ headers: { authorization: `Bearer ${TEST_CRON_SECRET}` } })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { calendar: Record<string, unknown> };
    // The sweep now runs the calendar AND form-detect queues (Phase 3).
    expect(body.calendar).toEqual({ processed: expect.any(Number), failed: expect.any(Number) });
  });

  it("POST with the right bearer drains a queued job", async () => {
    const { agent, deal } = await seedConnectedDeal();
    await enqueueCalendarJob({ kind: "deal-closing", id: deal.id });
    fakeCalendar(() => okJson("gevt-q5"));

    const res = await processPOST(
      processReq({
        method: "POST",
        headers: { authorization: `Bearer ${TEST_CRON_SECRET}` },
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).calendar).toEqual({ processed: 1, failed: 0 });

    const map = await prisma.calendar_event_map.findFirst({
      where: { user_id: agent.id, internal_uid: `close-${deal.id}` },
    });
    expect(map?.external_event_id).toBe("gevt-q5");
  });

  it("503 when CRON_SECRET is unset — even with an empty bearer", async () => {
    process.env.CRON_SECRET = "";
    resetEnvForTesting();
    try {
      // "Bearer " + empty secret must NOT slip through the equality check.
      const res = await processGET(
        processReq({ headers: { authorization: "Bearer " } })
      );
      expect(res.status).toBe(503);
    } finally {
      process.env.CRON_SECRET = TEST_CRON_SECRET;
      resetEnvForTesting();
    }
  });
});

// ── 6. safe to run on a frequent (every-5-min) cron ───────────────────────────
//
// #299 tightens the /api/jobs/process cron from daily (`0 6 * * *`) to
// `*/5 * * * *`. That cadence is only safe if the drain is a cheap no-op when
// nothing is due AND an already-drained job is never pushed a second time —
// otherwise firing every 5 minutes would spam duplicate calendar events. These
// tests assert both properties already hold for the existing sweep (pg-boss job
// consumption + calendar_event_map idempotency); they should pass as written.

describe("safe to call frequently (every-5-min cron)", () => {
  it("is a fast no-op that pushes nothing when the queue is empty", async () => {
    // Tripwire: fail loudly if a drain ever touches the provider edge with
    // nothing queued (it must not).
    const calls = fakeCalendar(() => {
      throw new Error("drain hit the calendar edge with nothing queued");
    });

    // Back-to-back drains — exactly what a tight cron does.
    expect(await processCalendarJobs({ limit: 25 })).toEqual({ processed: 0, failed: 0 });
    expect(await processCalendarJobs({ limit: 25 })).toEqual({ processed: 0, failed: 0 });

    expect(calls).toHaveLength(0);
    expect(await prisma.calendar_event_map.count()).toBe(0);
  });

  it("does not double-push a queued job across two consecutive drains", async () => {
    const { agent, deal } = await seedConnectedDeal();
    await enqueueCalendarJob({ kind: "deal-closing", id: deal.id });
    const calls = fakeCalendar(() => okJson("gevt-q6"));

    // First drain pushes the event once (a single create).
    expect(await processCalendarJobs({ limit: 25 })).toEqual({ processed: 1, failed: 0 });
    // Second drain fires immediately (the next cron tick, ~5 min later) — the
    // job was consumed, so there is nothing left to push.
    expect(await processCalendarJobs({ limit: 25 })).toEqual({ processed: 0, failed: 0 });

    // Exactly one create POST across BOTH drains — no duplicate calendar event.
    expect(calls.filter((c) => c.method === "POST" && c.url === G_EVENTS)).toHaveLength(1);

    // ...and a single mapping row, so a later sweep would PATCH (not re-create).
    const maps = await prisma.calendar_event_map.findMany({
      where: { user_id: agent.id, internal_uid: `close-${deal.id}` },
    });
    expect(maps).toHaveLength(1);
    expect(maps[0].external_event_id).toBe("gevt-q6");

    // The durable job is consumed — no future sweep will re-push it.
    expect(await runnableJobs()).toHaveLength(0);
  });
});
