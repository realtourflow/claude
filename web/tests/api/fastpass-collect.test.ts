import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { POST as collectRoute } from "@/app/api/deals/[id]/fastpass/collect/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser, createDeal } from "../helpers/factories";
import { prisma } from "@/lib/db";

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
});

beforeEach(async () => {
  await truncateAll();
});

function collectReq(dealId: string, authorization: string) {
  return new Request(`http://localhost/api/deals/${dealId}/fastpass/collect`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization,
    },
    body: JSON.stringify({}),
  });
}

// Seeds the deal's fast_pass JSONB column directly (no enrollment endpoint here).
async function seedFastPass(dealId: string, fastPass: object) {
  await prisma.$executeRawUnsafe(
    `UPDATE deals SET fast_pass = $1::jsonb WHERE id = $2::uuid`,
    JSON.stringify(fastPass),
    dealId
  );
}

describe("POST /api/deals/:id/fastpass/collect", () => {
  it("1. admin collects an eligible deal → 200 {ok:true} and persists collected status", async () => {
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const deal = await createDeal({ agent_id: agent.id });
    await seedFastPass(deal.id, {
      status: "active",
      payment_option: "at_closing",
    });

    const res = await collectRoute(
      collectReq(deal.id, await authHeader(admin.auth0_id, ["admin"])),
      { params: Promise.resolve({ id: deal.id }) }
    );
    expect(res.status).toBe(200);
    const out = (await res.json()) as { ok: boolean };
    expect(out.ok).toBe(true);

    const rows = await prisma.$queryRaw<
      { status: string; collected_at: string | null }[]
    >`
      SELECT fast_pass->>'status' AS status,
             fast_pass->>'collected_at' AS collected_at
      FROM deals
      WHERE id = ${deal.id}::uuid
    `;
    expect(rows[0].status).toBe("collected");
    expect(rows[0].collected_at).toBeTruthy();
  });

  it("2. seller_concession is also eligible → 200 {ok:true}", async () => {
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin2" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent2" });
    const deal = await createDeal({ agent_id: agent.id });
    await seedFastPass(deal.id, {
      status: "active",
      payment_option: "seller_concession",
    });

    const res = await collectRoute(
      collectReq(deal.id, await authHeader(admin.auth0_id, ["admin"])),
      { params: Promise.resolve({ id: deal.id }) }
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  it("3. non-admin (agent) → 403", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent3" });
    const deal = await createDeal({ agent_id: agent.id });
    await seedFastPass(deal.id, {
      status: "active",
      payment_option: "at_closing",
    });

    const res = await collectRoute(
      collectReq(deal.id, await authHeader(agent.auth0_id, ["agent"])),
      { params: Promise.resolve({ id: deal.id }) }
    );
    expect(res.status).toBe(403);

    // Untouched — still active.
    const rows = await prisma.$queryRaw<{ status: string }[]>`
      SELECT fast_pass->>'status' AS status FROM deals WHERE id = ${deal.id}::uuid
    `;
    expect(rows[0].status).toBe("active");
  });

  it("4. deal with no fast_pass → 404", async () => {
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin4" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent4" });
    const deal = await createDeal({ agent_id: agent.id });
    // fast_pass left NULL.

    const res = await collectRoute(
      collectReq(deal.id, await authHeader(admin.auth0_id, ["admin"])),
      { params: Promise.resolve({ id: deal.id }) }
    );
    expect(res.status).toBe(404);
  });

  it("5. fast_pass status not 'active' (already collected) → 404", async () => {
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin5" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent5" });
    const deal = await createDeal({ agent_id: agent.id });
    await seedFastPass(deal.id, {
      status: "collected",
      payment_option: "at_closing",
    });

    const res = await collectRoute(
      collectReq(deal.id, await authHeader(admin.auth0_id, ["admin"])),
      { params: Promise.resolve({ id: deal.id }) }
    );
    expect(res.status).toBe(404);
  });

  it("6. payment_option not in the eligible set (now) → 404", async () => {
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin6" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|agent6" });
    const deal = await createDeal({ agent_id: agent.id });
    await seedFastPass(deal.id, {
      status: "active",
      payment_option: "now",
    });

    const res = await collectRoute(
      collectReq(deal.id, await authHeader(admin.auth0_id, ["admin"])),
      { params: Promise.resolve({ id: deal.id }) }
    );
    expect(res.status).toBe(404);
  });
});
