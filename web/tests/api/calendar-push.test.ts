import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import { PATCH as stageRoute } from "@/app/api/deals/[id]/stage/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setCalendarHttpForTesting } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser, createDeal } from "../helpers/factories";

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
