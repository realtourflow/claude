import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { GET as getProfile, PATCH as patchProfile } from "@/app/api/me/profile/route";
import { POST as postIntake } from "@/app/api/me/intake/route";
import { GET as getDealIntake } from "@/app/api/deals/[id]/intake/route";
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

// ---------------------------------------------------------------------------
// Issue #175 — buyer & seller onboarding questionnaires must persist. The
// onboarding Done screen POSTs the full answer set; the deal's agent reads it
// back on the deal. Storage: deals.intake JSONB.
// ---------------------------------------------------------------------------

function intakeReq(body: unknown, auth: string) {
  return new Request("http://localhost/api/me/intake", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: auth },
    body: JSON.stringify(body),
  });
}

function dealIntakeReq(dealId: string, auth: string) {
  return getDealIntake(
    new Request(`http://localhost/api/deals/${dealId}/intake`, {
      headers: { authorization: auth },
    }),
    { params: Promise.resolve({ id: dealId }) }
  );
}

async function seedClientOnDeal(opts: {
  role: "buyer" | "seller";
  dealType: "buy" | "sell";
}) {
  const agent = await createUser({ role: "agent", auth0_id: `auth0|agent-${opts.role}` });
  const deal = await createDeal({ agent_id: agent.id, type: opts.dealType });
  const client = await createUser({ role: opts.role, auth0_id: `auth0|client-${opts.role}` });
  await prisma.deal_participants.create({
    data: { deal_id: deal.id, user_id: client.id, role: opts.role },
  });
  return { agent, deal, client };
}

describe("POST /api/me/intake + GET /api/deals/[id]/intake (#175)", () => {
  it("1. buyer intake persists and is readable by the deal's agent", async () => {
    const { agent, deal } = await seedClientOnDeal({ role: "buyer", dealType: "buy" });

    const answers = {
      firstTimeBuyer: "yes",
      bedrooms: "3",
      bathrooms: "2",
      areas: "Hoover, Vestavia Hills",
      minBudget: 250000,
      maxBudget: 425000,
      creditScore: "Good (720+)",
      monthlyIncome: "6500",
      lenderChoice: "mountain",
      trackingAddress: "42 Elm St, Birmingham, AL",
    };
    const res = await postIntake(
      intakeReq(
        { deal_id: deal.id, role: "buyer", answers },
        await authHeader("auth0|client-buyer", ["buyer"])
      )
    );
    expect(res.status).toBe(200);

    // Persisted on the deal.
    const row = await prisma.deals.findUnique({
      where: { id: deal.id },
      select: { intake: true },
    });
    const stored = row?.intake as {
      role: string;
      submitted_at: string;
      answers: Record<string, unknown>;
    };
    expect(stored.role).toBe("buyer");
    expect(stored.submitted_at).toBeTruthy();
    expect(stored.answers).toMatchObject(answers);

    // Readable by the deal's agent.
    const agentRes = await dealIntakeReq(
      deal.id,
      await authHeader(`auth0|agent-buyer`, ["agent"])
    );
    expect(agentRes.status).toBe(200);
    const body = (await agentRes.json()) as {
      intake: { role: string; answers: Record<string, unknown> };
    };
    expect(body.intake.role).toBe("buyer");
    expect(body.intake.answers.areas).toBe("Hoover, Vestavia Hills");
    expect(body.intake.answers.lenderChoice).toBe("mountain");
    expect(agent.id).toBeTruthy();
  });

  it("2. seller intake writes the property address onto the deal", async () => {
    const { deal } = await seedClientOnDeal({ role: "seller", dealType: "sell" });

    const res = await postIntake(
      intakeReq(
        {
          deal_id: deal.id,
          role: "seller",
          answers: {
            address: "123 Oak Lane, Birmingham, AL 35203",
            desiredListDate: "Within 30 days",
            whatMattersMost: "Speed of sale",
          },
        },
        await authHeader("auth0|client-seller", ["seller"])
      )
    );
    expect(res.status).toBe(200);

    const row = await prisma.deals.findUnique({
      where: { id: deal.id },
      select: { address: true, intake: true },
    });
    expect(row?.address).toBe("123 Oak Lane, Birmingham, AL 35203");
    expect(row?.intake).toBeTruthy();
  });

  it("3. seller intake does NOT clobber an agent-set deal address", async () => {
    const { deal } = await seedClientOnDeal({ role: "seller", dealType: "sell" });
    await prisma.deals.update({
      where: { id: deal.id },
      data: { address: "456 Agent-Entered Ave" },
    });

    const res = await postIntake(
      intakeReq(
        {
          deal_id: deal.id,
          role: "seller",
          answers: { address: "123 Oak Lane, Birmingham, AL 35203" },
        },
        await authHeader("auth0|client-seller", ["seller"])
      )
    );
    expect(res.status).toBe(200);

    const row = await prisma.deals.findUnique({
      where: { id: deal.id },
      select: { address: true, intake: true },
    });
    // Existing address preserved; intake still stored (the full answer set
    // keeps the seller's version visible to the agent).
    expect(row?.address).toBe("456 Agent-Entered Ave");
    const stored = row?.intake as { answers: Record<string, unknown> };
    expect(stored.answers.address).toBe("123 Oak Lane, Birmingham, AL 35203");
  });

  it("4. without deal_id the intake lands on the caller's participant deal of matching type", async () => {
    const { deal } = await seedClientOnDeal({ role: "buyer", dealType: "buy" });

    const res = await postIntake(
      intakeReq(
        { role: "buyer", answers: { areas: "Homewood" } },
        await authHeader("auth0|client-buyer", ["buyer"])
      )
    );
    expect(res.status).toBe(200);
    const out = (await res.json()) as { ok: boolean; deal_id: string };
    expect(out.deal_id).toBe(deal.id);

    const row = await prisma.deals.findUnique({
      where: { id: deal.id },
      select: { intake: true },
    });
    expect(row?.intake).toBeTruthy();
  });

  it("5. a stranger cannot read the intake; a non-participant cannot write it", async () => {
    const { deal } = await seedClientOnDeal({ role: "buyer", dealType: "buy" });
    await postIntake(
      intakeReq(
        { deal_id: deal.id, role: "buyer", answers: { areas: "Hoover" } },
        await authHeader("auth0|client-buyer", ["buyer"])
      )
    );

    // A different agent (not on the deal) cannot read it.
    await createUser({ role: "agent", auth0_id: "auth0|stranger-agent" });
    const readRes = await dealIntakeReq(
      deal.id,
      await authHeader("auth0|stranger-agent", ["agent"])
    );
    expect(readRes.status).toBe(404);

    // A buyer who is not a participant cannot write to the deal.
    await createUser({ role: "buyer", auth0_id: "auth0|stranger-buyer" });
    const writeRes = await postIntake(
      intakeReq(
        { deal_id: deal.id, role: "buyer", answers: { areas: "Hijack" } },
        await authHeader("auth0|stranger-buyer", ["buyer"])
      )
    );
    expect(writeRes.status).toBe(404);

    // Intake unchanged by the failed write.
    const row = await prisma.deals.findUnique({
      where: { id: deal.id },
      select: { intake: true },
    });
    const stored = row?.intake as { answers: Record<string, unknown> };
    expect(stored.answers.areas).toBe("Hoover");
  });

  it("6. the deal's participant client can read the intake back too", async () => {
    const { deal } = await seedClientOnDeal({ role: "buyer", dealType: "buy" });
    await postIntake(
      intakeReq(
        { deal_id: deal.id, role: "buyer", answers: { areas: "Hoover" } },
        await authHeader("auth0|client-buyer", ["buyer"])
      )
    );
    const res = await dealIntakeReq(deal.id, await authHeader("auth0|client-buyer", ["buyer"]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { intake: { answers: Record<string, unknown> } };
    expect(body.intake.answers.areas).toBe("Hoover");
  });

  it("7. rejects malformed intake: missing/invalid answers or bad role", async () => {
    const { deal } = await seedClientOnDeal({ role: "buyer", dealType: "buy" });
    const auth = await authHeader("auth0|client-buyer", ["buyer"]);

    // answers must be a plain object
    for (const answers of [undefined, null, "text", [1, 2, 3]]) {
      const res = await postIntake(intakeReq({ deal_id: deal.id, role: "buyer", answers }, auth));
      expect(res.status).toBe(400);
    }
    // role must be buyer|seller when it can't be inferred oddly
    const res = await postIntake(
      intakeReq({ deal_id: deal.id, role: "agent", answers: { a: 1 } }, auth)
    );
    expect(res.status).toBe(400);
  });

  it("8. GET returns { intake: null } when nothing was submitted yet", async () => {
    const { deal } = await seedClientOnDeal({ role: "buyer", dealType: "buy" });
    const res = await dealIntakeReq(deal.id, await authHeader("auth0|agent-buyer", ["agent"]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { intake: unknown };
    expect(body.intake).toBeNull();
  });
});
