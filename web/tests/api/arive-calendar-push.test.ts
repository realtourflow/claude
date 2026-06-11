import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import { POST as syncAriveRoute } from "@/app/api/deals/[id]/arive/sync/route";
import { POST as ariveWebhook } from "@/app/api/arive/webhook/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setAriveForTesting, type AriveClient } from "@/lib/arive";
import { setCalendarHttpForTesting } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser, createDeal } from "../helpers/factories";

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
});

afterEach(() => {
  setAriveForTesting(undefined);
  setCalendarHttpForTesting(undefined);
});

beforeEach(async () => {
  await truncateAll();
});

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function fakeAriveClient(): AriveClient {
  return {
    enabled: () => true,
    fetchLoan: async () => ({
      loanId: "loan-1",
      status: "processing",
      milestones: [],
      keyDates: { estimatedFundingDate: "2026-09-15" },
    }),
  };
}

/** Agent with a connected Google calendar + an ARIVE-linked deal (no key dates yet). */
async function connectedAriveDeal() {
  const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
  const deal = await createDeal({ agent_id: agent.id, title: "Elm St" });
  await prisma.deals.update({
    where: { id: deal.id },
    data: { arive_loan_id: "loan-1", arive_linked: true },
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

/** Calendar edge fake: records event POSTs, returns a fixed external id. */
function calendarFake() {
  const state = { posts: 0 };
  setCalendarHttpForTesting(async (_url, init) => {
    if ((init?.method ?? "GET") === "POST") state.posts += 1;
    return new Response(JSON.stringify({ id: "gevt-1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return state;
}

describe("ARIVE → calendar push", () => {
  it("manual sync pushes the closing event when key dates update", async () => {
    const { agent, deal } = await connectedAriveDeal();
    setAriveForTesting(fakeAriveClient());
    const cal = calendarFake();

    const req = new Request(
      `http://localhost/api/deals/${deal.id}/arive/sync`,
      {
        method: "POST",
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }
    );
    const res = await syncAriveRoute(req, ctx(deal.id));
    expect(res.status).toBe(200);

    const map = await prisma.calendar_event_map.findFirst({
      where: { user_id: agent.id, internal_uid: `close-${deal.id}` },
    });
    expect(map?.external_event_id).toBe("gevt-1");
    expect(cal.posts).toBe(1);
  });

  it("webhook sync pushes the closing event for the linked deal", async () => {
    const { agent, deal } = await connectedAriveDeal();
    setAriveForTesting(fakeAriveClient());
    calendarFake();

    const req = new Request("http://localhost/api/arive/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ loanId: "loan-1" }),
    });
    const res = await ariveWebhook(req);
    expect(res.status).toBe(200);

    // T15 (#83): the webhook awaits the sync (and its calendar push) before
    // acking — assert directly, no waitFor.
    const map = await prisma.calendar_event_map.findFirst({
      where: { user_id: agent.id, internal_uid: `close-${deal.id}` },
    });
    expect(map?.external_event_id).toBe("gevt-1");
  });
});
