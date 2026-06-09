import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  GET as listParticipantsRoute,
  POST as addParticipantRoute,
} from "@/app/api/deals/[id]/participants/route";
import { DELETE as removeParticipantRoute } from "@/app/api/deals/[id]/participants/[userId]/route";
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

function ctx<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

describe("POST /deals/[id]/participants — add by email", () => {
  it("resolves an EXISTING user by email (case-insensitive) and attaches them", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const coAgent = await createUser({
      role: "agent",
      email: "Co.Agent@Example.com",
      name: "Casey Co",
    });
    const deal = await createDeal({ agent_id: agent.id });

    const req = new Request(
      `http://localhost/api/deals/${deal.id}/participants`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        // Different casing than stored email — must still match.
        body: JSON.stringify({ email: "co.agent@example.com", role: "agent" }),
      }
    );
    const res = await addParticipantRoute(req, ctx({ id: deal.id }));
    expect(res.status).toBe(200);

    // Appears in GET, mapped to the resolved user.
    const listReq = new Request(
      `http://localhost/api/deals/${deal.id}/participants`,
      { headers: { authorization: await authHeader("auth0|a", ["agent"]) } }
    );
    const listRes = await listParticipantsRoute(listReq, ctx({ id: deal.id }));
    const list = (await listRes.json()) as {
      id: string;
      email: string;
      role: string;
    }[];
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(coAgent.id);
    expect(list[0].role).toBe("agent");
  });

  it("returns 404 with a guiding message for an unknown email", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });

    const req = new Request(
      `http://localhost/api/deals/${deal.id}/participants`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        body: JSON.stringify({ email: "nobody@nowhere.com", role: "buyer" }),
      }
    );
    const res = await addParticipantRoute(req, ctx({ id: deal.id }));
    expect(res.status).toBe(404);
    // Routes return plain-text errors (matches lib/http.ts `error()` / the Go
    // backend's http.Error). The client's ApiError surfaces this body text.
    const body = await res.text();
    expect(body).toMatch(/invite/i);

    // Nothing was attached.
    const count = await prisma.deal_participants.count({
      where: { deal_id: deal.id },
    });
    expect(count).toBe(0);
  });

  it("still accepts the legacy { user_id, role } body", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const buyer = await createUser({ role: "buyer" });
    const deal = await createDeal({ agent_id: agent.id });

    const req = new Request(
      `http://localhost/api/deals/${deal.id}/participants`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        body: JSON.stringify({ user_id: buyer.id, role: "buyer" }),
      }
    );
    const res = await addParticipantRoute(req, ctx({ id: deal.id }));
    expect(res.status).toBe(200);
    const count = await prisma.deal_participants.count({
      where: { deal_id: deal.id, user_id: buyer.id },
    });
    expect(count).toBe(1);
  });

  it("rejects an invalid role with 400", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const buyer = await createUser({ role: "buyer", email: "b@example.com" });
    const deal = await createDeal({ agent_id: agent.id });
    void buyer;

    const req = new Request(
      `http://localhost/api/deals/${deal.id}/participants`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        body: JSON.stringify({ email: "b@example.com", role: "wizard" }),
      }
    );
    const res = await addParticipantRoute(req, ctx({ id: deal.id }));
    expect(res.status).toBe(400);
  });

  it("handles a duplicate add gracefully (upsert, no crash, single row)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const buyer = await createUser({ role: "buyer", email: "dup@example.com" });
    const deal = await createDeal({ agent_id: agent.id });

    const make = async (role: string) =>
      addParticipantRoute(
        new Request(`http://localhost/api/deals/${deal.id}/participants`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: await authHeader("auth0|a", ["agent"]),
          },
          body: JSON.stringify({ email: "dup@example.com", role }),
        }),
        ctx({ id: deal.id })
      );

    const first = await make("buyer");
    expect(first.status).toBe(200);
    // Second add with a different role upserts the role rather than erroring.
    const second = await make("seller");
    expect(second.status).toBe(200);

    const rows = await prisma.deal_participants.findMany({
      where: { deal_id: deal.id, user_id: buyer.id },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].role).toBe("seller");
  });

  it("only the owning agent may add — a non-owner agent gets 404", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|owner" });
    const other = await createUser({ role: "agent", auth0_id: "auth0|other" });
    const buyer = await createUser({ role: "buyer", email: "x@example.com" });
    const deal = await createDeal({ agent_id: agent.id });
    void other;

    const req = new Request(
      `http://localhost/api/deals/${deal.id}/participants`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|other", ["agent"]),
        },
        body: JSON.stringify({ email: "x@example.com", role: "buyer" }),
      }
    );
    const res = await addParticipantRoute(req, ctx({ id: deal.id }));
    expect(res.status).toBe(404);
    void buyer;
  });
});

describe("DELETE /deals/[id]/participants/[userId]", () => {
  it("owning agent can remove a participant", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const buyer = await createUser({ role: "buyer" });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });

    const req = new Request(
      `http://localhost/api/deals/${deal.id}/participants/${buyer.id}`,
      {
        method: "DELETE",
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }
    );
    const res = await removeParticipantRoute(
      req,
      ctx({ id: deal.id, userId: buyer.id })
    );
    expect(res.status).toBe(200);
    const count = await prisma.deal_participants.count({
      where: { deal_id: deal.id },
    });
    expect(count).toBe(0);
  });

  it("a non-owner agent cannot remove — 404, row untouched", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|owner" });
    const other = await createUser({ role: "agent", auth0_id: "auth0|other" });
    const buyer = await createUser({ role: "buyer" });
    const deal = await createDeal({ agent_id: agent.id });
    void other;
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });

    const req = new Request(
      `http://localhost/api/deals/${deal.id}/participants/${buyer.id}`,
      {
        method: "DELETE",
        headers: { authorization: await authHeader("auth0|other", ["agent"]) },
      }
    );
    const res = await removeParticipantRoute(
      req,
      ctx({ id: deal.id, userId: buyer.id })
    );
    expect(res.status).toBe(404);
    const count = await prisma.deal_participants.count({
      where: { deal_id: deal.id },
    });
    expect(count).toBe(1);
  });
});
