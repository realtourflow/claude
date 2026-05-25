import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { GET as integrationsRoute } from "@/app/api/me/integrations/route";
import { GET as calendarUrlRoute } from "@/app/api/me/calendar-url/route";
import { GET as feedRoute } from "@/app/api/calendar/[token]/feed.ics/route";
import { DELETE as disconnectGoogleRoute } from "@/app/api/me/integrations/google-calendar/route";
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

describe("GET /api/me/integrations", () => {
  it("returns connected=true for Google Calendar when a token row exists", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await prisma.oauth_tokens.create({
      data: {
        user_id: user.id,
        provider: "google_calendar",
        access_token: "stub",
        account_email: "user@gmail.com",
        expires_at: new Date(Date.now() + 1000 * 60 * 60),
      },
    });
    const req = new Request("http://localhost/api/me/integrations", {
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await integrationsRoute(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      google_calendar: { connected: boolean; account_email?: string };
    };
    expect(body.google_calendar.connected).toBe(true);
    expect(body.google_calendar.account_email).toBe("user@gmail.com");
  });

  it("reports all integrations with sensible defaults", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const req = new Request("http://localhost/api/me/integrations", {
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await integrationsRoute(req);
    const body = (await res.json()) as {
      arive: { scope: string };
      docusign: { scope: string };
      stripe: { scope: string };
      google_calendar: { scope: string; connected: boolean };
      microsoft_calendar: { scope: string; connected: boolean };
    };
    expect(body.arive.scope).toBe("platform");
    expect(body.google_calendar.scope).toBe("user");
    expect(body.google_calendar.connected).toBe(false);
    expect(body.microsoft_calendar.connected).toBe(false);
  });
});

describe("DELETE /api/me/integrations/google-calendar", () => {
  it("deletes the token row and clears the event map", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await prisma.oauth_tokens.create({
      data: {
        user_id: user.id,
        provider: "google_calendar",
        access_token: "x",
        expires_at: new Date(Date.now() + 1000 * 60 * 60),
      },
    });
    await prisma.calendar_event_map.create({
      data: {
        user_id: user.id,
        provider: "google_calendar",
        internal_uid: "close-1",
        external_event_id: "evt-1",
      },
    });
    const req = new Request(
      "http://localhost/api/me/integrations/google-calendar",
      {
        method: "DELETE",
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }
    );
    const res = await disconnectGoogleRoute(req);
    expect(res.status).toBe(200);
    const tokens = await prisma.oauth_tokens.count({
      where: { user_id: user.id },
    });
    const map = await prisma.calendar_event_map.count({
      where: { user_id: user.id },
    });
    expect(tokens).toBe(0);
    expect(map).toBe(0);
  });
});

describe("Calendar feed", () => {
  it("GET /me/calendar-url issues a token and returns a subscription URL", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const req = new Request("http://localhost/api/me/calendar-url", {
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await calendarUrlRoute(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; token: string };
    expect(body.url).toMatch(/\/api\/calendar\/[a-f0-9]{48}\/feed\.ics$/);
    expect(body.token.length).toBe(48);
  });

  it("GET /calendar/[token]/feed.ics serves valid iCal with task due dates", async () => {
    const user = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: user.id, title: "Elm Street" });
    await prisma.users.update({
      where: { id: user.id },
      data: { calendar_token: "f".repeat(48) },
    });
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 7);
    await prisma.tasks.create({
      data: {
        deal_id: deal.id,
        title: "Send disclosures",
        status: "pending",
        due_date: tomorrow,
      },
    });
    const req = new Request(
      `http://localhost/api/calendar/${"f".repeat(48)}/feed.ics`
    );
    const res = await feedRoute(req, {
      params: Promise.resolve({ token: "f".repeat(48) }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/calendar/);
    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("Task: Send disclosures");
    expect(body).toContain("END:VCALENDAR");
  });

  it("returns 404 for an unknown calendar token", async () => {
    const req = new Request(`http://localhost/api/calendar/badtoken/feed.ics`);
    const res = await feedRoute(req, { params: Promise.resolve({ token: "badtoken" }) });
    expect(res.status).toBe(404);
  });
});
