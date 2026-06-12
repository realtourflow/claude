import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
} from "vitest";
import { POST as sendTemplateRoute } from "@/app/api/deals/[id]/docusign/send-template/route";
import { GET as prepRoute } from "@/app/api/deals/[id]/contracts/[formKey]/prep/route";
import { PUT as putFactsRoute } from "@/app/api/deals/[id]/contract-facts/route";
import { PUT as putTermsRoute } from "@/app/api/deals/[id]/contracts/[formKey]/terms/route";
import { POST as createDealRoute } from "@/app/api/deals/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import {
  setDocusignForTesting,
  type DocusignClient,
  type TemplateRole,
} from "@/lib/docusign";
import { prisma } from "@/lib/db";
import { resetEnvForTesting } from "@/lib/env";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser, createDeal } from "../helpers/factories";

// Contract-fill engine: core facts (shared per deal) + per-form terms feed the
// template's fieldMap to produce prefilled tabs at send time. Stage 1: every
// signer is an email recipient.

const TEMPLATES = {
  birmingham_general_financed: {
    templateId: "tpl-bham",
    label: "General/Financed Residential Contract",
    board: "BIRMINGHAM_AAR",
    roleMapping: { buyer: "Buyer", agent: "Agent" },
    fieldMap: {
      purchase_price: { label: "PurchasePrice", type: "text" },
      closing_date: { label: "ClosingDate", type: "text" },
      inspection_days: { label: "InspectionDays", type: "text" },
      home_warranty: { label: "HomeWarranty", type: "checkbox" },
    },
  },
  baldwin_residential_purchase: {
    templateId: "tpl-baldwin",
    label: "Residential Purchase Agreement",
    board: "BALDWIN_GULF_COAST",
    roleMapping: { buyer: "Buyer", agent: "Agent" },
    fieldMap: {
      purchase_price: { label: "Purchase_Price_GC", type: "text" },
      flood_zone: { label: "FloodZone", type: "checkbox", role: "Agent" },
    },
  },
};

type FakeDocusign = DocusignClient & {
  lastTemplateCreate?: { templateId: string; roles: TemplateRole[] };
};

function makeFakeDocusign(): FakeDocusign {
  const fake: FakeDocusign = {
    enabled: () => true,
    async createEnvelope() {
      return "env-adhoc";
    },
    async createTemplateEnvelope(templateId, roles) {
      fake.lastTemplateCreate = { templateId, roles };
      return "env-tpl-9";
    },
    async getEnvelopeStatus() {
      return "sent";
    },
  };
  return fake;
}

let fakeDocusign: FakeDocusign;
const savedEnv = process.env.DOCUSIGN_TEMPLATES;

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
});

beforeEach(async () => {
  await truncateAll();
  fakeDocusign = makeFakeDocusign();
  setDocusignForTesting(fakeDocusign);
  process.env.DOCUSIGN_TEMPLATES = JSON.stringify(TEMPLATES);
  resetEnvForTesting();
});

afterAll(() => {
  setDocusignForTesting(undefined);
  if (savedEnv === undefined) delete process.env.DOCUSIGN_TEMPLATES;
  else process.env.DOCUSIGN_TEMPLATES = savedEnv;
  resetEnvForTesting();
});

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function formCtx(id: string, formKey: string) {
  return { params: Promise.resolve({ id, formKey }) };
}

async function seedBhamDeal() {
  const agent = await createUser({ role: "agent", auth0_id: "auth0|agent" });
  await prisma.users.update({
    where: { id: agent.id },
    data: { market: "BIRMINGHAM_AAR" },
  });
  const buyer = await createUser({
    role: "buyer",
    auth0_id: "auth0|buyer",
    name: "Mike Smith",
    email: "mike@example.com",
  });
  const deal = await createDeal({ agent_id: agent.id });
  await prisma.deals.update({
    where: { id: deal.id },
    data: { market: "BIRMINGHAM_AAR", price: 410000 },
  });
  await prisma.deal_participants.create({
    data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
  });
  return { agent, buyer, deal };
}

function authedJson(method: string, url: string, body: unknown, auth: string) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", authorization: auth },
    body: JSON.stringify(body),
  });
}

describe("contract facts + prep", () => {
  it("PUT contract-facts upserts; GET prep prefills core facts with deal-price fallback", async () => {
    const { deal } = await seedBhamDeal();
    const auth = await authHeader("auth0|agent", ["agent"]);

    // Before any facts: purchase_price falls back to deals.price.
    let res = await prepRoute(
      new Request(
        `http://localhost/api/deals/${deal.id}/contracts/birmingham_general_financed/prep`,
        { headers: { authorization: auth } }
      ),
      formCtx(deal.id, "birmingham_general_financed")
    );
    expect(res.status).toBe(200);
    let body = (await res.json()) as {
      form: { key: string; label: string };
      core: { key: string; value: unknown }[];
      board_fields: { key: string; label: string; type: string; value: unknown }[];
    };
    const price = body.core.find((f) => f.key === "purchase_price");
    expect(price?.value).toBe("410000");

    // Save facts; prep now serves the saved value + dates round-trip.
    res = await putFactsRoute(
      authedJson(
        "PUT",
        `http://localhost/api/deals/${deal.id}/contract-facts`,
        {
          purchase_price: 425000,
          earnest_money_amount: 5000,
          earnest_money_holder: "Trustee Title",
          closing_date: "2026-08-15",
          financing_type: "conventional",
        },
        auth
      ),
      ctx(deal.id)
    );
    expect(res.status).toBe(200);

    res = await prepRoute(
      new Request(
        `http://localhost/api/deals/${deal.id}/contracts/birmingham_general_financed/prep`,
        { headers: { authorization: auth } }
      ),
      formCtx(deal.id, "birmingham_general_financed")
    );
    body = (await res.json()) as typeof body;
    expect(body.core.find((f) => f.key === "purchase_price")?.value).toBe("425000");
    expect(body.core.find((f) => f.key === "closing_date")?.value).toBe("2026-08-15");
    // Board-specific fields (fieldMap keys that aren't core facts) ride along.
    expect(body.board_fields.map((f) => f.key).sort()).toEqual([
      "home_warranty",
      "inspection_days",
    ]);
  });

  it("rejects facts keys outside the schema", async () => {
    const { deal } = await seedBhamDeal();
    const res = await putFactsRoute(
      authedJson(
        "PUT",
        `http://localhost/api/deals/${deal.id}/contract-facts`,
        { hacker_column: "x" },
        await authHeader("auth0|agent", ["agent"])
      ),
      ctx(deal.id)
    );
    expect(res.status).toBe(400);
  });
});

describe("contract terms validation", () => {
  it("accepts terms matching the fieldMap and persists them", async () => {
    const { deal } = await seedBhamDeal();
    const res = await putTermsRoute(
      authedJson(
        "PUT",
        `http://localhost/api/deals/${deal.id}/contracts/birmingham_general_financed/terms`,
        { terms: { inspection_days: 10, home_warranty: true } },
        await authHeader("auth0|agent", ["agent"])
      ),
      formCtx(deal.id, "birmingham_general_financed")
    );
    expect(res.status).toBe(200);
    const row = await prisma.deal_contract_terms.findFirst({
      where: { deal_id: deal.id, form_key: "birmingham_general_financed" },
    });
    expect(row?.terms).toEqual({ inspection_days: 10, home_warranty: true });
  });

  it("rejects unknown keys and wrong types against the fieldMap", async () => {
    const { deal } = await seedBhamDeal();
    const auth = await authHeader("auth0|agent", ["agent"]);
    let res = await putTermsRoute(
      authedJson(
        "PUT",
        `http://localhost/api/deals/${deal.id}/contracts/birmingham_general_financed/terms`,
        { terms: { mystery_field: 1 } },
        auth
      ),
      formCtx(deal.id, "birmingham_general_financed")
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/mystery_field/);

    res = await putTermsRoute(
      authedJson(
        "PUT",
        `http://localhost/api/deals/${deal.id}/contracts/birmingham_general_financed/terms`,
        { terms: { home_warranty: "yes please" } }, // checkbox wants boolean
        auth
      ),
      formCtx(deal.id, "birmingham_general_financed")
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/home_warranty/);
  });
});

describe("market gating", () => {
  it("blocks prep and send for another board's form", async () => {
    const { deal } = await seedBhamDeal(); // BIRMINGHAM deal
    const auth = await authHeader("auth0|agent", ["agent"]);

    const prep = await prepRoute(
      new Request(
        `http://localhost/api/deals/${deal.id}/contracts/baldwin_residential_purchase/prep`,
        { headers: { authorization: auth } }
      ),
      formCtx(deal.id, "baldwin_residential_purchase")
    );
    expect(prep.status).toBe(400);
    expect(await prep.text()).toMatch(/market|board/i);

    const send = await sendTemplateRoute(
      authedJson(
        "POST",
        `http://localhost/api/deals/${deal.id}/docusign/send-template`,
        { form_key: "baldwin_residential_purchase" },
        auth
      ),
      ctx(deal.id)
    );
    expect(send.status).toBe(400);
    expect(await send.text()).toMatch(/market|board/i);
  });
});

describe("prefilled send (Stage 1)", () => {
  it("sends the template with text + checkbox tabs from facts + terms; all signers email", async () => {
    const { deal } = await seedBhamDeal();
    const auth = await authHeader("auth0|agent", ["agent"]);
    await putFactsRoute(
      authedJson(
        "PUT",
        `http://localhost/api/deals/${deal.id}/contract-facts`,
        { purchase_price: 425000, closing_date: "2026-08-15" },
        auth
      ),
      ctx(deal.id)
    );
    await putTermsRoute(
      authedJson(
        "PUT",
        `http://localhost/api/deals/${deal.id}/contracts/birmingham_general_financed/terms`,
        { terms: { inspection_days: 10, home_warranty: true } },
        auth
      ),
      formCtx(deal.id, "birmingham_general_financed")
    );

    const res = await sendTemplateRoute(
      authedJson(
        "POST",
        `http://localhost/api/deals/${deal.id}/docusign/send-template`,
        { form_key: "birmingham_general_financed" },
        auth
      ),
      ctx(deal.id)
    );
    expect(res.status).toBe(200);

    const roles = fakeDocusign.lastTemplateCreate?.roles ?? [];
    const buyerRole = roles.find((r) => r.roleName === "Buyer");
    // fieldMap entries without a role land on the form's FIRST role (Buyer).
    expect(buyerRole?.tabs?.textTabs).toEqual(
      expect.arrayContaining([
        { tabLabel: "PurchasePrice", value: "425000" },
        { tabLabel: "ClosingDate", value: "08/15/2026" },
        { tabLabel: "InspectionDays", value: "10" },
      ])
    );
    expect(buyerRole?.tabs?.checkboxTabs).toEqual([
      { tabLabel: "HomeWarranty", selected: "true" },
    ]);
    // Stage 1: email recipients only.
    expect(roles.every((r) => r.clientUserId === undefined)).toBe(true);
  });

  it("the same deal facts fill two different forms' fieldMaps", async () => {
    const { agent, deal } = await seedBhamDeal();
    const auth = await authHeader("auth0|agent", ["agent"]);
    await putFactsRoute(
      authedJson(
        "PUT",
        `http://localhost/api/deals/${deal.id}/contract-facts`,
        { purchase_price: 425000 },
        auth
      ),
      ctx(deal.id)
    );

    // Send the Birmingham form, then flip the deal to the Gulf Coast market
    // and send Baldwin's — same fact, different tab label per fieldMap.
    await sendTemplateRoute(
      authedJson(
        "POST",
        `http://localhost/api/deals/${deal.id}/docusign/send-template`,
        { form_key: "birmingham_general_financed" },
        auth
      ),
      ctx(deal.id)
    );
    expect(
      fakeDocusign.lastTemplateCreate?.roles.find((r) => r.roleName === "Buyer")
        ?.tabs?.textTabs
    ).toEqual([{ tabLabel: "PurchasePrice", value: "425000" }]);

    await prisma.users.update({
      where: { id: agent.id },
      data: { market: "BALDWIN_GULF_COAST" },
    });
    await prisma.deals.update({
      where: { id: deal.id },
      data: { market: "BALDWIN_GULF_COAST" },
    });
    await sendTemplateRoute(
      authedJson(
        "POST",
        `http://localhost/api/deals/${deal.id}/docusign/send-template`,
        { form_key: "baldwin_residential_purchase" },
        auth
      ),
      ctx(deal.id)
    );
    expect(
      fakeDocusign.lastTemplateCreate?.roles.find((r) => r.roleName === "Buyer")
        ?.tabs?.textTabs
    ).toEqual([{ tabLabel: "Purchase_Price_GC", value: "425000" }]);
  });
});

describe("deal market default", () => {
  it("a new deal inherits the agent's market", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|mkt" });
    await prisma.users.update({
      where: { id: agent.id },
      data: { market: "BALDWIN_GULF_COAST" },
    });
    const res = await createDealRoute(
      authedJson(
        "POST",
        "http://localhost/api/deals",
        { title: "Market Test", type: "buy" },
        await authHeader("auth0|mkt", ["agent"])
      )
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    const row = await prisma.deals.findUnique({ where: { id: body.id } });
    expect(row?.market).toBe("BALDWIN_GULF_COAST");
  });
});
