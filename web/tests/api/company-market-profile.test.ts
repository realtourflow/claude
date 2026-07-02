import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { GET as getProfile, PATCH as patchProfile } from "@/app/api/me/profile/route";
import { GET as listBrokerages } from "@/app/api/brokerages/route";
import { GET as adminListBrokerages } from "@/app/api/admin/brokerages/route";
import { POST as reviewBrokerage } from "@/app/api/admin/brokerages/[id]/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setEmailForTesting } from "@/lib/email";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/factories";

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
  // Swallow the best-effort admin notification emails.
  setEmailForTesting({
    emails: { send: async () => ({ data: { id: "e" }, error: null }) },
  } as never);
});

afterAll(() => {
  setEmailForTesting(undefined);
});

beforeEach(async () => {
  await truncateAll();
});

async function patchReq(sub: string, body: object) {
  return new Request("http://localhost/api/me/profile", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: await authHeader(sub, ["agent"]),
    },
    body: JSON.stringify(body),
  });
}

describe("agent profile — markets (multi-select)", () => {
  it("saves markets and keeps users.market in sync as the FIRST pick", async () => {
    const a = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const res = await patchProfile(
      await patchReq("auth0|a", { markets: ["HUNTSVILLE", "DECATUR"] })
    );
    expect(res.status).toBe(200);

    const row = await prisma.users.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.markets).toEqual(["HUNTSVILLE", "DECATUR"]);
    expect(row.market).toBe("HUNTSVILLE"); // primary = first pick

    const get = await getProfile(
      new Request("http://localhost/api/me/profile", {
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      })
    );
    const body = (await get.json()) as { markets: string[]; market: string };
    expect(body.markets).toEqual(["HUNTSVILLE", "DECATUR"]);
    expect(body.market).toBe("HUNTSVILLE");
  });

  it("complete:false saves the profile WITHOUT flipping onboarding_complete", async () => {
    const a = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const res = await patchProfile(
      await patchReq("auth0|a", {
        brokerage: "ARC Realty",
        markets: ["HUNTSVILLE"],
        complete: false,
      })
    );
    expect(res.status).toBe(200);
    const row = await prisma.users.findUniqueOrThrow({ where: { id: a.id } });
    // Company + markets persisted (the upload gate passes mid-onboarding)…
    expect(row.brokerage).toBe("ARC Realty");
    expect(row.markets).toEqual(["HUNTSVILLE"]);
    // …but onboarding is NOT marked complete until the Done screen's PATCH.
    expect(row.onboarding_complete).toBe(false);

    // The Done-screen PATCH (no complete flag) finishes onboarding.
    await patchProfile(await patchReq("auth0|a", { name: "Agent A" }));
    const after = await prisma.users.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.onboarding_complete).toBe(true);
  });

  it("rejects an unknown market code and de-dupes repeats", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const bad = await patchProfile(
      await patchReq("auth0|a", { markets: ["HUNTSVILLE", "NOT_A_MARKET"] })
    );
    expect(bad.status).toBe(400);

    const dupes = await patchProfile(
      await patchReq("auth0|a", { markets: ["LAKE_MARTIN", "LAKE_MARTIN"] })
    );
    expect(dupes.status).toBe(200);
    const row = await prisma.users.findFirstOrThrow({
      where: { auth0_id: "auth0|a" },
    });
    expect(row.markets).toEqual(["LAKE_MARTIN"]);
  });
});

describe("company list + 'Other' review queue", () => {
  async function seedActive(name: string) {
    await prisma.brokerages.create({ data: { name, status: "active" } });
  }

  it("GET /brokerages returns only the ACTIVE list, alphabetized", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    await seedActive("RE/MAX");
    await seedActive("ARC Realty");
    await prisma.brokerages.create({
      data: { name: "Pending Realty", status: "pending" },
    });

    const res = await listBrokerages(
      new Request("http://localhost/api/brokerages", {
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(["ARC Realty", "RE/MAX"]);
  });

  it("an unknown company saved on the profile lands in the pending queue (once)", async () => {
    const a = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await seedActive("ARC Realty");

    // A known company does NOT get queued.
    await patchProfile(await patchReq("auth0|a", { brokerage: "ARC Realty" }));
    expect(await prisma.brokerages.count({ where: { status: "pending" } })).toBe(0);

    // An unknown one does — attributed to the agent.
    await patchProfile(await patchReq("auth0|a", { brokerage: "River City Realty" }));
    const pending = await prisma.brokerages.findMany({ where: { status: "pending" } });
    expect(pending).toHaveLength(1);
    expect(pending[0].name).toBe("River City Realty");
    expect(pending[0].suggested_by).toBe(a.id);

    // Saving again (even with different case) does not duplicate the suggestion —
    // and the profile is CANONICALIZED to the queued row's exact spelling so
    // future promotion matching is byte-exact.
    await patchProfile(await patchReq("auth0|a", { brokerage: "river city realty" }));
    expect(await prisma.brokerages.count()).toBe(2); // ARC + the one suggestion
    const row = await prisma.users.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.brokerage).toBe("River City Realty");
  });

  it("canonicalizes a case-variant of a managed company to the list's spelling", async () => {
    const a = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await seedActive("ARC Realty");
    await patchProfile(await patchReq("auth0|a", { brokerage: "  arc realty " }));
    const row = await prisma.users.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.brokerage).toBe("ARC Realty"); // trimmed + canonical
    expect(await prisma.brokerages.count({ where: { status: "pending" } })).toBe(0);
  });

  it("buyers/sellers cannot queue company suggestions", async () => {
    await createUser({ role: "buyer", auth0_id: "auth0|b" });
    const req = new Request("http://localhost/api/me/profile", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|b", ["buyer"]),
      },
      body: JSON.stringify({ brokerage: "Junk Realty" }),
    });
    expect((await patchProfile(req)).status).toBe(200);
    expect(await prisma.brokerages.count({ where: { status: "pending" } })).toBe(0);
  });

  it("admin approves a suggestion into the dropdown; reject keeps it out", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    await patchProfile(await patchReq("auth0|a", { brokerage: "River City Realty" }));

    const adminHdr = await authHeader("auth0|admin", ["admin"]);
    const queue = await adminListBrokerages(
      new Request("http://localhost/api/admin/brokerages?status=pending", {
        headers: { authorization: adminHdr },
      })
    );
    const rows = (await queue.json()) as { id: string; name: string }[];
    expect(rows.map((r) => r.name)).toContain("River City Realty");
    const id = rows[0].id;

    const approve = await reviewBrokerage(
      new Request(`http://localhost/api/admin/brokerages/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: adminHdr },
        body: JSON.stringify({ action: "approve" }),
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(approve.status).toBe(200);

    // Now in the agent-facing dropdown.
    const list = await listBrokerages(
      new Request("http://localhost/api/brokerages", {
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      })
    );
    expect(await list.json()).toContain("River City Realty");

    // Re-reviewing 409s.
    const again = await reviewBrokerage(
      new Request(`http://localhost/api/admin/brokerages/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: adminHdr },
        body: JSON.stringify({ action: "reject" }),
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(again.status).toBe(409);
  });

  it("the admin queue is admin-only", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const res = await adminListBrokerages(
      new Request("http://localhost/api/admin/brokerages", {
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      })
    );
    expect(res.status).toBe(403);
  });
});
