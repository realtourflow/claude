import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import {
  GET as getMlsRoute,
  PATCH as patchMlsRoute,
} from "@/app/api/me/mls/route";
import { GET as searchRoute } from "@/app/api/deals/[id]/listings/search/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import {
  setSimplyretsForTesting,
  SimplyRetsAuthError,
  type SimplyRetsClient,
  type SearchParams,
} from "@/lib/simplyrets";
import type { MLSListing } from "@/hooks/useMLS";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser, createDeal } from "../helpers/factories";

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
});

afterEach(() => {
  setSimplyretsForTesting(undefined);
});

beforeEach(async () => {
  await truncateAll();
});

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const SAMPLE_LISTING: MLSListing = {
  mlsId: "mls-1",
  listPrice: 450000,
  address: { full: "123 Main St", city: "Austin", state: "TX", postalCode: "78701" },
  property: { bedrooms: 3, bathsFull: 2, area: 1800, subType: "SingleFamilyResidence" },
  photos: ["https://photos.test/1.jpg"],
  mls: { status: "Active", daysOnMarket: 7 },
  remarks: "Charming home.",
};

// A fake SimplyRETS client that records calls and returns canned listings. The
// route tests inject this so they never touch the real SimplyRETS API.
function fakeClient(opts?: {
  listings?: MLSListing[];
  throwErr?: Error;
  calls?: { key: string; secret: string; params: SearchParams }[];
}): SimplyRetsClient {
  return {
    search: async (key, secret, params) => {
      opts?.calls?.push({ key, secret, params });
      if (opts?.throwErr) throw opts.throwErr;
      return opts?.listings ?? [SAMPLE_LISTING];
    },
  };
}

describe("GET /api/me/mls", () => {
  it("connected=false before any creds, true after PATCH; never returns the secret", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    void agent;

    setSimplyretsForTesting(fakeClient());

    // Before: not connected.
    const before = await getMlsRoute(
      new Request("http://localhost/api/me/mls", {
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      })
    );
    expect(before.status).toBe(200);
    const beforeBody = (await before.json()) as Record<string, unknown>;
    expect(beforeBody).toEqual({ connected: false });
    expect(beforeBody).not.toHaveProperty("secret");
    expect(beforeBody).not.toHaveProperty("mls_secret");
    expect(beforeBody).not.toHaveProperty("key");

    // Save creds.
    const patch = await patchMlsRoute(
      new Request("http://localhost/api/me/mls", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        body: JSON.stringify({ key: "k-123", secret: "s-456" }),
      })
    );
    expect(patch.status).toBe(200);

    // After: connected, still no secret exposed.
    const after = await getMlsRoute(
      new Request("http://localhost/api/me/mls", {
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      })
    );
    const afterBody = (await after.json()) as Record<string, unknown>;
    expect(afterBody).toEqual({ connected: true });
    expect(afterBody).not.toHaveProperty("secret");
    expect(afterBody).not.toHaveProperty("mls_secret");
  });

  it("401 without a token", async () => {
    const res = await getMlsRoute(new Request("http://localhost/api/me/mls"));
    expect(res.status).toBe(401);
  });

  it("404 when the JWT subject has no DB user", async () => {
    setSimplyretsForTesting(fakeClient());
    const res = await getMlsRoute(
      new Request("http://localhost/api/me/mls", {
        headers: { authorization: await authHeader("auth0|ghost", ["agent"]) },
      })
    );
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/me/mls", () => {
  it("saves key + secret (read-back via prisma) and returns { ok, connected:true }", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    setSimplyretsForTesting(fakeClient());

    const res = await patchMlsRoute(
      new Request("http://localhost/api/me/mls", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        body: JSON.stringify({ key: "real-key", secret: "real-secret" }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, connected: true });

    const row = await prisma.users.findUnique({
      where: { id: agent.id },
      select: { mls_key: true, mls_secret: true },
    });
    expect(row?.mls_key).toBe("real-key");
    expect(row?.mls_secret).toBe("real-secret");
  });

  it("real 401 (SimplyRetsAuthError) → 400 invalid + nothing saved", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    // A genuine auth rejection is a typed SimplyRetsAuthError (what the real
    // client throws on a 401) — this must still be reported as invalid creds.
    setSimplyretsForTesting(
      fakeClient({ throwErr: new SimplyRetsAuthError("invalid MLS credentials") })
    );

    const res = await patchMlsRoute(
      new Request("http://localhost/api/me/mls", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        body: JSON.stringify({ key: "bad", secret: "bad" }),
      })
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/invalid/i);

    const row = await prisma.users.findUnique({
      where: { id: agent.id },
      select: { mls_key: true, mls_secret: true },
    });
    expect(row?.mls_key).toBeNull();
    expect(row?.mls_secret).toBeNull();
  });

  it("a transient outage (5xx/timeout) → 502 temporarily-unavailable, NOT 400 invalid (#309)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    void agent;
    // A 5xx / network / timeout surfaces as a generic (non-auth) Error. The
    // agent's credentials may be perfectly valid — they must not be told they
    // are wrong just because SimplyRETS is down.
    setSimplyretsForTesting(
      fakeClient({
        throwErr: new Error("simplyrets: 503 Service Unavailable"),
      })
    );

    const res = await patchMlsRoute(
      new Request("http://localhost/api/me/mls", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        // Valid-shaped credentials — the only problem is the outage.
        body: JSON.stringify({ key: "real-key", secret: "real-secret" }),
      })
    );

    // Distinct from the 400 invalid-credentials path.
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toMatch(/invalid/i);
    expect(text).toMatch(/unavailable|try again/i);
  });

  it("an outage does NOT clear or overwrite previously-saved creds (#309)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    // Agent already has working creds on file.
    await prisma.users.update({
      where: { id: agent.id },
      data: { mls_key: "old-key", mls_secret: "old-secret" },
    });

    // They try to update to new creds while SimplyRETS is having an outage.
    setSimplyretsForTesting(
      fakeClient({
        throwErr: new Error("simplyrets: 500 Internal Server Error"),
      })
    );

    const res = await patchMlsRoute(
      new Request("http://localhost/api/me/mls", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        body: JSON.stringify({ key: "new-key", secret: "new-secret" }),
      })
    );
    expect(res.status).toBe(502);

    // Prior saved state is untouched — not cleared, not overwritten.
    const row = await prisma.users.findUnique({
      where: { id: agent.id },
      select: { mls_key: true, mls_secret: true },
    });
    expect(row?.mls_key).toBe("old-key");
    expect(row?.mls_secret).toBe("old-secret");
  });

  it("empty key/secret disconnects: creds nulled, connected:false (no validation call)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    // Seed existing creds.
    await prisma.users.update({
      where: { id: agent.id },
      data: { mls_key: "old-key", mls_secret: "old-secret" },
    });

    // A client that would throw if invoked — disconnect must NOT call it.
    setSimplyretsForTesting(
      fakeClient({ throwErr: new Error("should not be called") })
    );

    const res = await patchMlsRoute(
      new Request("http://localhost/api/me/mls", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        body: JSON.stringify({ key: "", secret: "" }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, connected: false });

    const row = await prisma.users.findUnique({
      where: { id: agent.id },
      select: { mls_key: true, mls_secret: true },
    });
    expect(row?.mls_key).toBeNull();
    expect(row?.mls_secret).toBeNull();
  });

  it("401 without a token", async () => {
    const res = await patchMlsRoute(
      new Request("http://localhost/api/me/mls", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "k", secret: "s" }),
      })
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /api/deals/[id]/listings/search", () => {
  it("returns mapped MLSListing[] using the deal agent's creds + passed-through params", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await prisma.users.update({
      where: { id: agent.id },
      data: { mls_key: "agent-key", mls_secret: "agent-secret" },
    });
    const deal = await createDeal({ agent_id: agent.id });

    const calls: { key: string; secret: string; params: SearchParams }[] = [];
    setSimplyretsForTesting(fakeClient({ calls }));

    const res = await searchRoute(
      new Request(
        `http://localhost/api/deals/${deal.id}/listings/search?minprice=300000&maxprice=600000&minbeds=3&cities=Austin&cities=Round%20Rock`,
        { headers: { authorization: await authHeader("auth0|a", ["agent"]) } }
      ),
      ctx(deal.id)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as MLSListing[];
    expect(body).toEqual([SAMPLE_LISTING]);

    // Used the deal agent's creds, not anyone else's.
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe("agent-key");
    expect(calls[0].secret).toBe("agent-secret");
    // Query params passed through.
    expect(calls[0].params.minPrice).toBe(300000);
    expect(calls[0].params.maxPrice).toBe(600000);
    expect(calls[0].params.minBeds).toBe(3);
    expect(calls[0].params.cities).toEqual(["Austin", "Round Rock"]);
  });

  it("a participant (buyer) may search; the deal agent's creds are still used", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await prisma.users.update({
      where: { id: agent.id },
      data: { mls_key: "agent-key", mls_secret: "agent-secret" },
    });
    const buyer = await createUser({ role: "buyer", auth0_id: "auth0|b" });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });

    const calls: { key: string; secret: string; params: SearchParams }[] = [];
    setSimplyretsForTesting(fakeClient({ calls }));

    const res = await searchRoute(
      new Request(
        `http://localhost/api/deals/${deal.id}/listings/search`,
        { headers: { authorization: await authHeader("auth0|b", ["buyer"]) } }
      ),
      ctx(deal.id)
    );
    expect(res.status).toBe(200);
    expect(calls[0].key).toBe("agent-key");
  });

  it("503 when the deal agent has not connected MLS (Go handler behavior)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    setSimplyretsForTesting(fakeClient());

    const res = await searchRoute(
      new Request(`http://localhost/api/deals/${deal.id}/listings/search`, {
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }),
      ctx(deal.id)
    );
    expect(res.status).toBe(503);
  });

  it("502 when SimplyRETS errors", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await prisma.users.update({
      where: { id: agent.id },
      data: { mls_key: "agent-key", mls_secret: "agent-secret" },
    });
    const deal = await createDeal({ agent_id: agent.id });
    setSimplyretsForTesting(
      fakeClient({ throwErr: new Error("simplyrets: 500 Internal Server Error") })
    );

    const res = await searchRoute(
      new Request(`http://localhost/api/deals/${deal.id}/listings/search`, {
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      }),
      ctx(deal.id)
    );
    expect(res.status).toBe(502);
  });

  it("404 when caller has no access to the deal", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await prisma.users.update({
      where: { id: agent.id },
      data: { mls_key: "agent-key", mls_secret: "agent-secret" },
    });
    const stranger = await createUser({ role: "agent", auth0_id: "auth0|s" });
    void stranger;
    const deal = await createDeal({ agent_id: agent.id });
    setSimplyretsForTesting(fakeClient());

    const res = await searchRoute(
      new Request(`http://localhost/api/deals/${deal.id}/listings/search`, {
        headers: { authorization: await authHeader("auth0|s", ["agent"]) },
      }),
      ctx(deal.id)
    );
    expect(res.status).toBe(404);
  });

  it("401 without a token", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const res = await searchRoute(
      new Request(`http://localhost/api/deals/${deal.id}/listings/search`),
      ctx(deal.id)
    );
    expect(res.status).toBe(401);
  });
});
