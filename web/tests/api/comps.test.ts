import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { GET as compsRoute } from "@/app/api/deals/[id]/properties/[propId]/comps/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import {
  setSimplyretsForTesting,
  SimplyRetsAuthError,
  type SimplyRetsClient,
  type SearchParams,
} from "@/lib/simplyrets";
import { COMP_DISCLAIMER } from "@/lib/comps";
import type { MLSListing } from "@/hooks/useMLS";
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

afterEach(() => {
  setSimplyretsForTesting(undefined);
});

/** A sale one month back — comfortably inside the tightest (6-month) tier. */
const RECENT = new Date(Date.now() - 30 * 24 * 3600 * 1000)
  .toISOString()
  .slice(0, 10);

function soldListing(
  overrides: {
    mlsId?: string;
    closePrice?: number;
    closeDate?: string;
    city?: string;
    postalCode?: string;
    beds?: number;
    area?: number;
  } = {}
): MLSListing {
  return {
    mlsId: overrides.mlsId ?? "m1",
    listPrice: 0,
    address: {
      full: "1 Comp St",
      city: overrides.city ?? "Hoover",
      state: "AL",
      postalCode: overrides.postalCode ?? "",
    },
    property: {
      bedrooms: overrides.beds ?? 3,
      bathsFull: 2,
      area: overrides.area ?? 2000,
      subType: "SingleFamilyResidence",
    },
    photos: [],
    mls: { status: "Closed", daysOnMarket: 0 },
    sales: {
      closePrice: overrides.closePrice ?? 240000,
      closeDate: overrides.closeDate ?? RECENT,
    },
    remarks: "",
  };
}

/** Five sales at $100–140/sqft on 2000 sqft → p25 $110, p75 $130. */
function fiveSales(): MLSListing[] {
  return [200000, 220000, 240000, 260000, 280000].map((closePrice, i) =>
    soldListing({ mlsId: `m${i}`, closePrice })
  );
}

function fakeClient(
  listings: MLSListing[],
  calls?: SearchParams[]
): SimplyRetsClient {
  return {
    async search(_key, _secret, params) {
      calls?.push(params);
      return listings;
    },
  };
}

function throwingClient(err: Error): SimplyRetsClient {
  return {
    async search() {
      throw err;
    },
  };
}

function ctx(id: string, propId: string) {
  return { params: Promise.resolve({ id, propId }) };
}

async function getComps(
  dealId: string,
  propId: string,
  auth0: string,
  roles: string[] = ["agent"]
): Promise<Response> {
  const req = new Request(
    `http://localhost/api/deals/${dealId}/properties/${propId}/comps`,
    { headers: { authorization: await authHeader(auth0, roles) } }
  );
  return compsRoute(req, ctx(dealId, propId));
}

/** Agent with MLS connected, a buy deal, and a 3bd/2000sqft subject property. */
async function seedSubject(
  opts: { mls?: boolean; city?: string; address?: string } = {}
) {
  const agent = await createUser({ role: "agent", auth0_id: "auth0|agentA" });
  if (opts.mls !== false) {
    // Stored plaintext — decryptField passes legacy plaintext straight through.
    await prisma.users.update({
      where: { id: agent.id },
      data: { mls_key: "test-key", mls_secret: "test-secret" },
    });
  }
  const deal = await createDeal({ agent_id: agent.id, type: "buy" });
  const property = await prisma.tracked_properties.create({
    data: {
      deal_id: deal.id,
      address: opts.address ?? "500 Subject Ln",
      city: opts.city ?? "Hoover",
      state: "AL",
      beds: 3,
      baths: 2,
      sqft: 2000,
    },
  });
  return { agent, deal, property };
}

describe("GET /deals/:id/properties/:propId/comps — happy path", () => {
  it("returns a p25–p75 range with comps and the disclaimer", async () => {
    const { deal, property } = await seedSubject();
    setSimplyretsForTesting(fakeClient(fiveSales()));

    const res = await getComps(deal.id, property.id, "auth0|agentA");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, never>;

    expect(body.range).toEqual({ low: 220000, high: 260000 });
    expect(body.basis).toBe("price_per_sqft");
    expect(body.median_price_per_sqft).toBe(120);
    expect(body.comp_count).toBe(5);
    expect(body.widened).toBe(false);
    expect(body.reason).toBeNull();
    expect(body.disclaimer).toBe(COMP_DISCLAIMER);
    expect(body.subject).toMatchObject({ id: property.id, city: "Hoover", sqft: 2000 });
  });

  it("asks SimplyRETS for CLOSED sales bracketed by the widest tier", async () => {
    const { deal, property } = await seedSubject();
    const calls: SearchParams[] = [];
    setSimplyretsForTesting(fakeClient(fiveSales(), calls));

    await getComps(deal.id, property.id, "auth0|agentA");

    expect(calls).toHaveLength(1);
    const p = calls[0];
    expect(p.status).toBe("Closed");
    expect(p.cities).toEqual(["Hoover"]);
    // Widest tier = beds ±2, sqft ±50% of 2000.
    expect(p.minBeds).toBe(1);
    expect(p.maxBeds).toBe(5);
    expect(p.minArea).toBe(1000);
    expect(p.maxArea).toBe(3000);
  });

  it("reports widening when the tight tier is too thin", async () => {
    const { deal, property } = await seedSubject();
    // Three sales 9 months back — outside 6mo, inside 12mo.
    const old = new Date(Date.now() - 275 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    setSimplyretsForTesting(
      fakeClient(
        [200000, 240000, 280000].map((closePrice, i) =>
          soldListing({ mlsId: `o${i}`, closePrice, closeDate: old })
        )
      )
    );

    const res = await getComps(deal.id, property.id, "auth0|agentA");
    const body = (await res.json()) as Record<string, never>;
    expect(body.widened).toBe(true);
    expect(String(body.tier_used)).toContain("12mo");
    expect(body.range).not.toBeNull();
  });

  it("returns no range with a reason when the feed has too few sales", async () => {
    const { deal, property } = await seedSubject();
    setSimplyretsForTesting(fakeClient([soldListing({ mlsId: "only" })]));

    const res = await getComps(deal.id, property.id, "auth0|agentA");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, never>;
    expect(body.range).toBeNull();
    expect(body.reason).toBe("insufficient_comps");
    expect(body.disclaimer).toBe(COMP_DISCLAIMER);
  });

  it("returns no_comps when the feed carries no closed sales at all", async () => {
    const { deal, property } = await seedSubject();
    setSimplyretsForTesting(fakeClient([]));

    const res = await getComps(deal.id, property.id, "auth0|agentA");
    const body = (await res.json()) as Record<string, never>;
    expect(body.range).toBeNull();
    expect(body.reason).toBe("no_comps");
  });

  it("ignores listings with no sale price (active rows in a closed feed)", async () => {
    const { deal, property } = await seedSubject();
    const noSale = soldListing({ mlsId: "active" });
    delete (noSale as { sales?: unknown }).sales;
    setSimplyretsForTesting(fakeClient([...fiveSales(), noSale]));

    const res = await getComps(deal.id, property.id, "auth0|agentA");
    const body = (await res.json()) as { comps: { mlsId: string }[] };
    expect(body.comps.map((c) => c.mlsId)).not.toContain("active");
  });

  it("rejects an outlier sale and reports the count", async () => {
    const { deal, property } = await seedSubject();
    const wild = soldListing({ mlsId: "wild", closePrice: 1_500_000 });
    setSimplyretsForTesting(fakeClient([...fiveSales(), wild]));

    const res = await getComps(deal.id, property.id, "auth0|agentA");
    const body = (await res.json()) as {
      outliers_removed: number;
      comps: { mlsId: string }[];
    };
    expect(body.outliers_removed).toBe(1);
    expect(body.comps.map((c) => c.mlsId)).not.toContain("wild");
  });

  it("scopes to the subject's ZIP when its address carries one", async () => {
    // Address ends in a ZIP → same-ZIP comps win over same-city other-ZIP ones.
    const { deal, property } = await seedSubject({
      address: "500 Subject Ln, Hoover, AL 35244",
    });
    const inZip = [200000, 220000, 240000].map((p, i) =>
      soldListing({ mlsId: `z${i}`, closePrice: p, postalCode: "35244" })
    );
    const otherZip = soldListing({
      mlsId: "farzip",
      closePrice: 999000,
      postalCode: "35080",
    });
    setSimplyretsForTesting(fakeClient([...inZip, otherZip]));

    const res = await getComps(deal.id, property.id, "auth0|agentA");
    const body = (await res.json()) as {
      subject: { postal_code: string | null };
      tier_used: string;
      comps: { mlsId: string }[];
    };
    expect(body.subject.postal_code).toBe("35244");
    expect(body.tier_used).toContain("same ZIP");
    expect(body.comps.map((c) => c.mlsId)).not.toContain("farzip");
  });
});

describe("GET comps — access control (agent-only, MLS licensing)", () => {
  it("404s for a buyer participant on the deal", async () => {
    const { deal, property } = await seedSubject();
    const buyer = await createUser({ role: "buyer", auth0_id: "auth0|buyer" });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });
    setSimplyretsForTesting(fakeClient(fiveSales()));

    const res = await getComps(deal.id, property.id, "auth0|buyer", ["buyer"]);
    expect(res.status).toBe(404);
    // Nothing about the comps or the range leaks in the body.
    expect(await res.text()).not.toContain("disclaimer");
  });

  it("404s for a different agent", async () => {
    const { deal, property } = await seedSubject();
    await createUser({ role: "agent", auth0_id: "auth0|agentB" });
    setSimplyretsForTesting(fakeClient(fiveSales()));

    const res = await getComps(deal.id, property.id, "auth0|agentB");
    expect(res.status).toBe(404);
  });

  it("404s on malformed ids instead of 500ing", async () => {
    const { deal, property } = await seedSubject();
    expect((await getComps("nope", property.id, "auth0|agentA")).status).toBe(404);
    expect((await getComps(deal.id, "nope", "auth0|agentA")).status).toBe(404);
  });

  it("404s when the property belongs to a different deal", async () => {
    const { agent, property } = await seedSubject();
    const otherDeal = await createDeal({ agent_id: agent.id, type: "buy" });
    setSimplyretsForTesting(fakeClient(fiveSales()));

    const res = await getComps(otherDeal.id, property.id, "auth0|agentA");
    expect(res.status).toBe(404);
  });
});

describe("GET comps — MLS failure modes", () => {
  it("503s when the agent has not connected MLS", async () => {
    const { deal, property } = await seedSubject({ mls: false });
    const res = await getComps(deal.id, property.id, "auth0|agentA");
    expect(res.status).toBe(503);
  });

  it("502s when SimplyRETS is failing", async () => {
    const { deal, property } = await seedSubject();
    setSimplyretsForTesting(throwingClient(new Error("simplyrets: 500")));

    const res = await getComps(deal.id, property.id, "auth0|agentA");
    expect(res.status).toBe(502);
  });

  it("502s on bad MLS credentials", async () => {
    const { deal, property } = await seedSubject();
    setSimplyretsForTesting(throwingClient(new SimplyRetsAuthError()));

    const res = await getComps(deal.id, property.id, "auth0|agentA");
    expect(res.status).toBe(502);
  });

  it("422s when the subject property has no city to search", async () => {
    const { deal, property } = await seedSubject({ city: "" });
    setSimplyretsForTesting(fakeClient(fiveSales()));

    const res = await getComps(deal.id, property.id, "auth0|agentA");
    expect(res.status).toBe(422);
  });
});
