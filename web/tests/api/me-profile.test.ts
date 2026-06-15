import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { GET as getProfile, PATCH as patchProfile } from "@/app/api/me/profile/route";
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

function patch(body: unknown, auth: string) {
  return new Request("http://localhost/api/me/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: auth },
    body: JSON.stringify(body),
  });
}
function get(auth: string) {
  return new Request("http://localhost/api/me/profile", {
    headers: { authorization: auth },
  });
}

describe("GET /api/me/profile", () => {
  it("returns the caller's name, phone, market, and brokerage", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await prisma.users.update({
      where: { id: agent.id },
      data: { phone: "205-555-0100", market: "BIRMINGHAM_AAR", brokerage: "RE/MAX" },
    });
    const res = await getProfile(get(await authHeader("auth0|a", ["agent"])));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      name: agent.name,
      phone: "205-555-0100",
      market: "BIRMINGHAM_AAR",
      brokerage: "RE/MAX",
    });
  });
});

describe("PATCH /api/me/profile", () => {
  it("saves market + brokerage onto the profile record", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const res = await patchProfile(
      patch(
        { market: "BALDWIN_GULF_COAST", brokerage: "Keller Williams" },
        await authHeader("auth0|a", ["agent"])
      )
    );
    expect(res.status).toBe(200);
    const row = await prisma.users.findUnique({ where: { id: agent.id } });
    expect(row?.market).toBe("BALDWIN_GULF_COAST");
    expect(row?.brokerage).toBe("Keller Williams");
  });

  it("still saves name + phone (existing behavior)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await patchProfile(
      patch({ name: "Sarah J", phone: "205-555-0199" }, await authHeader("auth0|a", ["agent"]))
    );
    const row = await prisma.users.findUnique({ where: { id: agent.id } });
    expect(row?.name).toBe("Sarah J");
    expect(row?.phone).toBe("205-555-0199");
  });

  it("rejects an invalid market", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const res = await patchProfile(
      patch({ market: "ATLANTA_MLS" }, await authHeader("auth0|a", ["agent"]))
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/market/i);
    // Nothing persisted.
    const row = await prisma.users.findUnique({ where: { id: agent.id } });
    expect(row?.market).toBe("");
  });

  it("accepts empty-string market (clearing it) and only-some fields", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await prisma.users.update({
      where: { id: agent.id },
      data: { market: "BIRMINGHAM_AAR" },
    });
    const res = await patchProfile(
      patch({ brokerage: "Independent" }, await authHeader("auth0|a", ["agent"]))
    );
    expect(res.status).toBe(200);
    const row = await prisma.users.findUnique({ where: { id: agent.id } });
    // Untouched market preserved; brokerage updated.
    expect(row?.market).toBe("BIRMINGHAM_AAR");
    expect(row?.brokerage).toBe("Independent");
  });
});
