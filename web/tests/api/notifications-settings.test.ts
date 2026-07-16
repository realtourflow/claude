import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { GET as listNotifsRoute } from "@/app/api/notifications/route";
import { PATCH as readNotifRoute } from "@/app/api/notifications/[id]/read/route";
import { POST as readAllRoute } from "@/app/api/notifications/read-all/route";
import { POST as createMessageRoute } from "@/app/api/deals/[id]/messages/route";
import { PATCH as advanceStageRoute } from "@/app/api/deals/[id]/stage/route";
import { POST as createPropRoute } from "@/app/api/deals/[id]/properties/route";
import { PATCH as patchPropRoute } from "@/app/api/deals/[id]/properties/[propId]/route";
import {
  GET as getSettingsRoute,
  PUT as putSettingsRoute,
} from "@/app/api/me/settings/route";
import { PATCH as patchProfileRoute } from "@/app/api/me/profile/route";
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

describe("Notifications", () => {
  it("lists user's notifications, unread first then read", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    // Two notifs — one read, one unread. Unread should come first.
    const oldUnread = await prisma.notifications.create({
      data: { user_id: user.id, title: "unread", type: "test" },
    });
    void oldUnread;
    await prisma.notifications.create({
      data: {
        user_id: user.id,
        title: "read",
        type: "test",
        read_at: new Date(),
      },
    });

    const req = new Request("http://localhost/api/notifications", {
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await listNotifsRoute(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; read: boolean }[];
    expect(body.length).toBe(2);
    expect(body[0].title).toBe("unread");
    expect(body[0].read).toBe(false);
    expect(body[1].title).toBe("read");
    expect(body[1].read).toBe(true);
  });

  it("PATCH /notifications/[id]/read marks one read", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const n = await prisma.notifications.create({
      data: { user_id: user.id, title: "x", type: "test" },
    });
    const req = new Request(`http://localhost/api/notifications/${n.id}/read`, {
      method: "PATCH",
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await readNotifRoute(req, ctx(n.id));
    expect(res.status).toBe(200);
    const row = await prisma.notifications.findUnique({ where: { id: n.id } });
    expect(row?.read_at).not.toBeNull();
  });

  it("POST /notifications/read-all marks all unread read", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await prisma.notifications.createMany({
      data: [
        { user_id: user.id, title: "1", type: "test" },
        { user_id: user.id, title: "2", type: "test" },
      ],
    });
    const req = new Request("http://localhost/api/notifications/read-all", {
      method: "POST",
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await readAllRoute(req);
    expect(res.status).toBe(200);
    const unread = await prisma.notifications.count({
      where: { user_id: user.id, read_at: null },
    });
    expect(unread).toBe(0);
  });

  it("cannot mark someone else's notification read (404)", async () => {
    const owner = await createUser({ role: "agent" });
    const other = await createUser({ role: "agent", auth0_id: "auth0|o" });
    const n = await prisma.notifications.create({
      data: { user_id: owner.id, title: "x", type: "test" },
    });
    void other;
    const req = new Request(`http://localhost/api/notifications/${n.id}/read`, {
      method: "PATCH",
      headers: { authorization: await authHeader("auth0|o", ["agent"]) },
    });
    const res = await readNotifRoute(req, ctx(n.id));
    expect(res.status).toBe(404);
  });
});

describe("User settings", () => {
  it("returns {} when no row exists, then upserts on PUT", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const getReq = new Request("http://localhost/api/me/settings", {
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const getRes = await getSettingsRoute(getReq);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({});

    const putReq = new Request("http://localhost/api/me/settings", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ theme: "dark", density: "compact" }),
    });
    const putRes = await putSettingsRoute(putReq);
    expect(putRes.status).toBe(200);

    const getRes2 = await getSettingsRoute(
      new Request("http://localhost/api/me/settings", {
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      })
    );
    expect(await getRes2.json()).toEqual({ theme: "dark", density: "compact" });
  });
});

// #291 — every in-app notification must carry a NON-null, role-appropriate
// `href` so the AppLayout bell deep-links to the right resource instead of '#'.
// The href reuses lib/notification-email.ts `recipientUrl` (relative path):
// agents/admins → /agent/deals/:dealId, buyers → /buyer/:userId,
// sellers → /seller/:userId, TCs → /tc/deals.
describe("Notification hrefs are clickable (#291)", () => {
  function dealCtx(id: string) {
    return { params: Promise.resolve({ id }) };
  }
  function propCtx(id: string, propId: string) {
    return { params: Promise.resolve({ id, propId }) };
  }

  type NotifRow = {
    id: string;
    title: string;
    type: string;
    deal_id: string | null;
    href: string | null;
  };

  async function listNotifsFor(sub: string, roles: string[]): Promise<NotifRow[]> {
    const req = new Request("http://localhost/api/notifications", {
      headers: { authorization: await authHeader(sub, roles) },
    });
    const res = await listNotifsRoute(req);
    expect(res.status).toBe(200);
    return (await res.json()) as NotifRow[];
  }

  // Case 1 — fails today: an agent's client-thread message to a buyer participant
  // produced a notification with href === null. It must deep-link the buyer to
  // their own portal (/buyer/:userId), the app's only client deal view.
  it("Case 1: a message to a buyer participant sets href to the buyer's portal", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const buyer = await createUser({ role: "buyer", auth0_id: "auth0|buyer" });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });

    const req = new Request(`http://localhost/api/deals/${deal.id}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|agent", ["agent"]),
      },
      body: JSON.stringify({ channel: "client_thread", body: "hi buyer" }),
    });
    const res = await createMessageRoute(req, dealCtx(deal.id));
    expect(res.status).toBe(201);

    const notifs = await listNotifsFor("auth0|buyer", ["buyer"]);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].type).toBe("new_message");
    expect(notifs[0].href).not.toBeNull();
    expect(notifs[0].href).toBe(`/buyer/${buyer.id}`);
  });

  // A client's reply notifies the agent — the agent's href is the agent deal route.
  it("Case 1b: a client's message to the agent sets href to the agent deal route", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const buyer = await createUser({ role: "buyer", auth0_id: "auth0|buyer" });
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
      body: JSON.stringify({ channel: "client_thread", body: "hi agent" }),
    });
    const res = await createMessageRoute(req, dealCtx(deal.id));
    expect(res.status).toBe(201);

    const notifs = await listNotifsFor("auth0|agent", ["agent"]);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].type).toBe("new_message");
    expect(notifs[0].href).toBe(`/agent/deals/${deal.id}`);
  });

  // Case 2 — a stage change fans out to participants; each href is role-appropriate:
  // buyers/sellers land on their own portal (agents would use /agent/deals/:id).
  it("Case 2: a stage change deep-links each participant to their portal", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const buyer = await createUser({ role: "buyer", auth0_id: "auth0|buyer" });
    const seller = await createUser({ role: "seller", auth0_id: "auth0|seller" });
    const deal = await createDeal({ agent_id: agent.id, stage: "intake" });
    await prisma.deal_participants.createMany({
      data: [
        { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
        { deal_id: deal.id, user_id: seller.id, role: "seller" },
      ],
    });

    const req = new Request(`http://localhost/api/deals/${deal.id}/stage`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|agent", ["agent"]),
      },
      body: JSON.stringify({ stage: "active_search" }),
    });
    const res = await advanceStageRoute(req, dealCtx(deal.id));
    expect(res.status).toBe(200);

    const buyerNotifs = await listNotifsFor("auth0|buyer", ["buyer"]);
    expect(buyerNotifs).toHaveLength(1);
    expect(buyerNotifs[0].type).toBe("stage_change");
    expect(buyerNotifs[0].href).toBe(`/buyer/${buyer.id}`);

    const sellerNotifs = await listNotifsFor("auth0|seller", ["seller"]);
    expect(sellerNotifs).toHaveLength(1);
    expect(sellerNotifs[0].type).toBe("stage_change");
    expect(sellerNotifs[0].href).toBe(`/seller/${seller.id}`);
  });

  // Case 3 — an offer-request notification targets the deal's agent; its href is
  // the agent deal route (/agent/deals/:id).
  it("Case 3: an offer-request notification deep-links the agent to the deal", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const buyer = await createUser({ role: "buyer", auth0_id: "auth0|buyer" });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });

    // Seed a tracked property via the agent POST route (offer_requested defaults false).
    const seedReq = new Request(
      `http://localhost/api/deals/${deal.id}/properties`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|agent", ["agent"]),
        },
        body: JSON.stringify({ address: "123 Test St" }),
      }
    );
    const seedRes = await createPropRoute(seedReq, dealCtx(deal.id));
    expect(seedRes.status).toBe(201);
    const prop = (await seedRes.json()) as { id: string };

    // The buyer flips offer_requested → true, which notifies the agent.
    const req = new Request(
      `http://localhost/api/deals/${deal.id}/properties/${prop.id}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|buyer", ["buyer"]),
        },
        body: JSON.stringify({ offer_requested: true }),
      }
    );
    const res = await patchPropRoute(req, propCtx(deal.id, prop.id));
    expect(res.status).toBe(200);

    const notifs = await listNotifsFor("auth0|agent", ["agent"]);
    const offer = notifs.find((n) => n.type === "offer_requested");
    expect(offer).toBeDefined();
    expect(offer?.href).toBe(`/agent/deals/${deal.id}`);
  });
});

describe("PATCH /me/profile", () => {
  it("updates name and phone, marks onboarding_complete=true", async () => {
    const user = await createUser({
      role: "agent",
      auth0_id: "auth0|a",
      name: "Old Name",
    });
    expect(user).toBeTruthy();
    const req = new Request("http://localhost/api/me/profile", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ name: "New Name", phone: "555-1212" }),
    });
    const res = await patchProfileRoute(req);
    expect(res.status).toBe(200);

    const row = await prisma.users.findUnique({ where: { auth0_id: "auth0|a" } });
    expect(row?.name).toBe("New Name");
    expect(row?.phone).toBe("555-1212");
    expect(row?.onboarding_complete).toBe(true);
  });
});
