/**
 * Net sheet API tests (#181).
 *
 * The Go→Next port dropped `buildDefaultLines`: GET auto-created sheets with
 * `lines: []` and `sale_price: 0`, making the seller's proceeds estimate
 * unusable. These tests pin the restored behavior:
 *  - Case 1: auto-create seeds the standard deduction lines + the deal price.
 *  - Case 2: commission pct comes from the deal / agent settings.
 *  - Case 3: the agent can add/edit/remove a custom line and it persists.
 * Plus the legacy access semantics: participants only see `ready` sheets.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { GET as getNetSheet, PUT as putNetSheet } from "@/app/api/deals/[id]/net-sheet/route";
import { POST as markReadyRoute } from "@/app/api/deals/[id]/net-sheet/ready/route";
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

type Line = {
  id: string;
  label: string;
  category: string;
  amount: number;
  pct?: number | null;
  is_pct: boolean;
  required: boolean;
  enabled: boolean;
  editable: boolean;
  auto_populated: boolean;
};

type Sheet = {
  id: string;
  deal_id: string;
  sale_price: number;
  lines: Line[];
  status: string;
};

async function makeAgentWithDeal(opts: {
  type?: "buy" | "sell";
  price?: number | null;
  commissionPct?: number;
} = {}) {
  const agent = await createUser({ role: "agent", auth0_id: "auth0|agent-ns" });
  const deal = await createDeal({ agent_id: agent.id, type: opts.type ?? "sell" });
  await prisma.deals.update({
    where: { id: deal.id },
    data: {
      price: opts.price === undefined ? 500_000 : opts.price,
      ...(opts.commissionPct !== undefined ? { commission_pct: opts.commissionPct } : {}),
    },
  });
  return { agent, deal };
}

async function agentGet(dealId: string, auth0Id = "auth0|agent-ns"): Promise<Response> {
  const req = new Request(`http://localhost/api/deals/${dealId}/net-sheet`, {
    headers: { authorization: await authHeader(auth0Id, ["agent"]) },
  });
  return getNetSheet(req, ctx(dealId));
}

function lineById(sheet: Sheet, id: string): Line {
  const line = sheet.lines.find((l) => l.id === id);
  expect(line, `expected line "${id}" in [${sheet.lines.map((l) => l.id).join(", ")}]`).toBeDefined();
  return line as Line;
}

describe("GET /api/deals/:id/net-sheet — default seeding (case 1)", () => {
  it("returns 401 without auth", async () => {
    const res = await getNetSheet(
      new Request("http://localhost/api/deals/x/net-sheet"),
      ctx("00000000-0000-0000-0000-000000000000")
    );
    expect(res.status).toBe(401);
  });

  it("auto-creates a sell-deal sheet seeded with default lines and the deal price", async () => {
    const { deal } = await makeAgentWithDeal({ type: "sell", price: 500_000 });

    const res = await agentGet(deal.id);
    expect(res.status).toBe(201);
    const sheet = (await res.json()) as Sheet;

    expect(sheet.sale_price).toBe(500_000);
    expect(sheet.status).toBe("draft");
    expect(sheet.lines.map((l) => l.id)).toEqual([
      "listing_commission",
      "buyers_agent_commission",
      "title_closing_fee",
      "transfer_taxes",
      "property_tax_proration",
      "mortgage_payoff",
      "seller_concessions",
      "repair_credits",
      "termite",
      "septic",
      "home_warranty",
      "hoa_payoff",
      "survey",
    ]);

    const listing = lineById(sheet, "listing_commission");
    expect(listing.category).toBe("commission");
    expect(listing.is_pct).toBe(true);
    expect(listing.pct).toBe(3);
    expect(listing.amount).toBe(15_000);
    expect(listing.required).toBe(true);
    expect(listing.enabled).toBe(true);
    expect(listing.editable).toBe(true);

    const buyers = lineById(sheet, "buyers_agent_commission");
    expect(buyers.pct).toBe(3);
    expect(buyers.amount).toBe(15_000);

    const title = lineById(sheet, "title_closing_fee");
    expect(title.category).toBe("title");
    expect(title.amount).toBe(0);
    expect(title.required).toBe(true);
    expect(title.enabled).toBe(true);

    const transfer = lineById(sheet, "transfer_taxes");
    expect(transfer.category).toBe("taxes");
    expect(transfer.is_pct).toBe(true);
    expect(transfer.pct).toBe(0.1);
    expect(transfer.amount).toBe(500); // 0.1% of 500k
    expect(transfer.auto_populated).toBe(true);

    const proration = lineById(sheet, "property_tax_proration");
    expect(proration.category).toBe("proration");
    expect(proration.amount).toBe(0);
    expect(proration.required).toBe(true);

    const payoff = lineById(sheet, "mortgage_payoff");
    expect(payoff.category).toBe("payoff");
    expect(payoff.required).toBe(false);
    expect(payoff.enabled).toBe(false);
    expect(payoff.editable).toBe(true);
  });

  it("auto-creates a buy-deal sheet with the closing-cost estimate line set", async () => {
    const { deal } = await makeAgentWithDeal({ type: "buy", price: 400_000 });

    const res = await agentGet(deal.id);
    expect(res.status).toBe(201);
    const sheet = (await res.json()) as Sheet;

    expect(sheet.sale_price).toBe(400_000);
    expect(sheet.lines.map((l) => l.id)).toEqual([
      "buyers_agent_commission",
      "title_closing_fee",
      "transfer_taxes",
      "property_tax_proration",
      "appraisal",
      "termite",
      "septic",
      "hoa_dues",
    ]);
    expect(lineById(sheet, "buyers_agent_commission").amount).toBe(12_000);
    expect(lineById(sheet, "transfer_taxes").amount).toBe(400);
  });

  it("seeds sale_price 0 and zero commission amounts when the deal has no price", async () => {
    const { deal } = await makeAgentWithDeal({ type: "sell", price: null });

    const res = await agentGet(deal.id);
    expect(res.status).toBe(201);
    const sheet = (await res.json()) as Sheet;
    expect(sheet.sale_price).toBe(0);
    expect(lineById(sheet, "listing_commission").amount).toBe(0);
    expect(lineById(sheet, "transfer_taxes").amount).toBe(0);
  });

  it("does not reseed an existing sheet on subsequent GETs", async () => {
    const { deal } = await makeAgentWithDeal({});
    const first = await agentGet(deal.id);
    expect(first.status).toBe(201);

    // Agent clears the lines…
    const putReq = new Request(`http://localhost/api/deals/${deal.id}/net-sheet`, {
      method: "PUT",
      headers: { authorization: await authHeader("auth0|agent-ns", ["agent"]) },
      body: JSON.stringify({ lines: [] }),
    });
    expect((await putNetSheet(putReq, ctx(deal.id))).status).toBe(200);

    // …and the next GET must NOT bring the defaults back.
    const second = await agentGet(deal.id);
    expect(second.status).toBe(200);
    const sheet = (await second.json()) as Sheet;
    expect(sheet.lines).toEqual([]);
  });
});

describe("commission pct sourcing (case 2)", () => {
  it("uses the agent's onboarding settings (camelCase shape)", async () => {
    const { agent, deal } = await makeAgentWithDeal({ type: "sell", price: 500_000 });
    await prisma.user_settings.create({
      data: {
        user_id: agent.id,
        settings: {
          buyerCommission: { isPct: false, pct: null, amount: 4000 },
          sellerCommission: { isPct: true, pct: 2.5, amount: null },
        },
      },
    });

    const sheet = (await (await agentGet(deal.id)).json()) as Sheet;

    const listing = lineById(sheet, "listing_commission");
    expect(listing.is_pct).toBe(true);
    expect(listing.pct).toBe(2.5);
    expect(listing.amount).toBe(12_500);
    expect(listing.auto_populated).toBe(true);

    const buyers = lineById(sheet, "buyers_agent_commission");
    expect(buyers.is_pct).toBe(false);
    expect(buyers.amount).toBe(4000);
    expect(buyers.auto_populated).toBe(true);
  });

  it("supports the legacy Go-era snake_case settings shape", async () => {
    const { agent, deal } = await makeAgentWithDeal({ type: "sell", price: 500_000 });
    await prisma.user_settings.create({
      data: {
        user_id: agent.id,
        settings: {
          buyer_commission: { is_pct: true, pct: 2.75, amount: null },
          seller_commission: { is_pct: true, pct: 2, amount: null },
        },
      },
    });

    const sheet = (await (await agentGet(deal.id)).json()) as Sheet;
    expect(lineById(sheet, "listing_commission").amount).toBe(10_000);
    expect(lineById(sheet, "buyers_agent_commission").amount).toBe(13_750);
  });

  it("uses the per-deal commission_pct for the agent's own side when set off-default", async () => {
    const { deal } = await makeAgentWithDeal({
      type: "sell",
      price: 500_000,
      commissionPct: 2,
    });

    const sheet = (await (await agentGet(deal.id)).json()) as Sheet;
    const listing = lineById(sheet, "listing_commission");
    expect(listing.pct).toBe(2);
    expect(listing.amount).toBe(10_000);
    // The other side stays on the default.
    expect(lineById(sheet, "buyers_agent_commission").pct).toBe(3);
  });

  it("per-deal commission_pct (off-default) beats agent settings for the own-side line", async () => {
    const { agent, deal } = await makeAgentWithDeal({
      type: "sell",
      price: 500_000,
      commissionPct: 2,
    });
    await prisma.user_settings.create({
      data: {
        user_id: agent.id,
        settings: { sellerCommission: { isPct: true, pct: 2.5, amount: null } },
      },
    });

    const sheet = (await (await agentGet(deal.id)).json()) as Sheet;
    expect(lineById(sheet, "listing_commission").pct).toBe(2);
    expect(lineById(sheet, "listing_commission").amount).toBe(10_000);
  });
});

describe("custom lines (case 3)", () => {
  const custom: Line = {
    id: "custom_staging_1",
    label: "Staging",
    category: "custom",
    amount: 1200,
    pct: null,
    is_pct: false,
    required: false,
    enabled: true,
    editable: true,
    auto_populated: false,
  };

  async function put(dealId: string, lines: Line[]): Promise<Response> {
    const req = new Request(`http://localhost/api/deals/${dealId}/net-sheet`, {
      method: "PUT",
      headers: { authorization: await authHeader("auth0|agent-ns", ["agent"]) },
      body: JSON.stringify({ lines }),
    });
    return putNetSheet(req, ctx(dealId));
  }

  it("agent can add, edit, and remove a custom line and it persists", async () => {
    const { deal } = await makeAgentWithDeal({});
    const seeded = (await (await agentGet(deal.id)).json()) as Sheet;

    // Add
    expect((await put(deal.id, [...seeded.lines, custom])).status).toBe(200);
    let sheet = (await (await agentGet(deal.id)).json()) as Sheet;
    expect(lineById(sheet, "custom_staging_1").amount).toBe(1200);
    expect(lineById(sheet, "custom_staging_1").label).toBe("Staging");

    // Edit
    const edited = sheet.lines.map((l) =>
      l.id === "custom_staging_1" ? { ...l, amount: 950 } : l
    );
    expect((await put(deal.id, edited)).status).toBe(200);
    sheet = (await (await agentGet(deal.id)).json()) as Sheet;
    expect(lineById(sheet, "custom_staging_1").amount).toBe(950);

    // Remove
    const removed = sheet.lines.filter((l) => l.id !== "custom_staging_1");
    expect((await put(deal.id, removed)).status).toBe(200);
    sheet = (await (await agentGet(deal.id)).json()) as Sheet;
    expect(sheet.lines.find((l) => l.id === "custom_staging_1")).toBeUndefined();
  });
});

describe("participant access — sellers only see ready sheets", () => {
  async function addSeller(dealId: string) {
    const seller = await createUser({ role: "seller", auth0_id: "auth0|seller-ns" });
    await prisma.deal_participants.create({
      data: { deal_id: dealId, user_id: seller.id, role: "seller" },
    });
    return seller;
  }

  async function sellerGet(dealId: string): Promise<Response> {
    const req = new Request(`http://localhost/api/deals/${dealId}/net-sheet`, {
      headers: { authorization: await authHeader("auth0|seller-ns", ["seller"]) },
    });
    return getNetSheet(req, ctx(dealId));
  }

  it("participant GET does NOT auto-create and returns 403 while no sheet exists", async () => {
    const { deal } = await makeAgentWithDeal({});
    await addSeller(deal.id);

    const res = await sellerGet(deal.id);
    expect(res.status).toBe(403);
    expect(await prisma.net_sheets.count({ where: { deal_id: deal.id } })).toBe(0);
  });

  it("participant gets 403 for a draft sheet, 200 once marked ready", async () => {
    const { deal } = await makeAgentWithDeal({});
    await addSeller(deal.id);
    await agentGet(deal.id); // agent creates the draft

    expect((await sellerGet(deal.id)).status).toBe(403);

    const readyReq = new Request(`http://localhost/api/deals/${deal.id}/net-sheet/ready`, {
      method: "POST",
      headers: { authorization: await authHeader("auth0|agent-ns", ["agent"]) },
      body: JSON.stringify({ ready: true }),
    });
    expect((await markReadyRoute(readyReq, ctx(deal.id))).status).toBe(200);

    const res = await sellerGet(deal.id);
    expect(res.status).toBe(200);
    const sheet = (await res.json()) as Sheet;
    expect(sheet.status).toBe("ready");
    expect(sheet.lines.length).toBeGreaterThan(0);
  });

  it("returns 404 for a user with no access to the deal", async () => {
    const { deal } = await makeAgentWithDeal({});
    await createUser({ role: "agent", auth0_id: "auth0|stranger-ns" });
    const req = new Request(`http://localhost/api/deals/${deal.id}/net-sheet`, {
      headers: { authorization: await authHeader("auth0|stranger-ns", ["agent"]) },
    });
    expect((await getNetSheet(req, ctx(deal.id))).status).toBe(404);
  });
});
