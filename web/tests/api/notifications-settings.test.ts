import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { GET as listNotifsRoute } from "@/app/api/notifications/route";
import { PATCH as readNotifRoute } from "@/app/api/notifications/[id]/read/route";
import { POST as readAllRoute } from "@/app/api/notifications/read-all/route";
import {
  GET as getSettingsRoute,
  PUT as putSettingsRoute,
} from "@/app/api/me/settings/route";
import { PATCH as patchProfileRoute } from "@/app/api/me/profile/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/factories";

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
