import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { POST as sendTemplateRoute } from "@/app/api/deals/[id]/docusign/send-template/route";
import { GET as prepRoute } from "@/app/api/deals/[id]/contracts/[formKey]/prep/route";
import { PUT as putTermsRoute } from "@/app/api/deals/[id]/contracts/[formKey]/terms/route";
import { GET as listTemplatesRoute } from "@/app/api/docusign/templates/route";
import {
  getTemplateConfig,
  TemplateConfigError,
  UnknownFormError,
} from "@/lib/docusign-templates";
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

// The Buyer Agency Agreement is a COMMITTED form (lib/contract-forms.ts) whose
// template id comes from DOCUSIGN_TEMPLATE_IDS env. It's universal (every AL
// market), flips deals.baa_signed on completion, auto-fills party/agent names,
// and prefills the agent-entered terms.

type FakeDocusign = DocusignClient & {
  lastTemplateCreate?: { templateId: string; roles: TemplateRole[] };
};
function makeFake(): FakeDocusign {
  const fake: FakeDocusign = {
    enabled: () => true,
    async createEnvelope() {
      return "env-adhoc";
    },
    async createTemplateEnvelope(templateId, roles) {
      fake.lastTemplateCreate = { templateId, roles };
      return "env-baa-1";
    },
    async getEnvelopeStatus() {
      return "sent";
    },
    async downloadCombinedDocument() {
      return new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    },
    async listRecipients() {
      return [];
    },
    async createRecipientView() {
      return "https://demo.docusign.net/signing/fake";
    },
  };
  return fake;
}

let fake: FakeDocusign;
const savedTemplates = process.env.DOCUSIGN_TEMPLATES;
const savedIds = process.env.DOCUSIGN_TEMPLATE_IDS;

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
});

beforeEach(async () => {
  await truncateAll();
  fake = makeFake();
  setDocusignForTesting(fake);
  // BAA is live: its template id is configured. No legacy DOCUSIGN_TEMPLATES.
  process.env.DOCUSIGN_TEMPLATES = "{}";
  process.env.DOCUSIGN_TEMPLATE_IDS = JSON.stringify({
    buyer_agency_agreement: "tpl-baa-real",
  });
  resetEnvForTesting();
});

afterAll(() => {
  setDocusignForTesting(undefined);
  if (savedTemplates === undefined) delete process.env.DOCUSIGN_TEMPLATES;
  else process.env.DOCUSIGN_TEMPLATES = savedTemplates;
  if (savedIds === undefined) delete process.env.DOCUSIGN_TEMPLATE_IDS;
  else process.env.DOCUSIGN_TEMPLATE_IDS = savedIds;
  resetEnvForTesting();
});

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function formCtx(id: string, formKey: string) {
  return { params: Promise.resolve({ id, formKey }) };
}
function authedJson(method: string, url: string, body: unknown, auth: string) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", authorization: auth },
    body: JSON.stringify(body),
  });
}

async function seedDeal(market = "BALDWIN_GULF_COAST") {
  const agent = await createUser({
    role: "agent",
    auth0_id: "auth0|agent",
    name: "Sarah Johnson",
    email: "sarah@example.com",
  });
  await prisma.users.update({
    where: { id: agent.id },
    data: { market, brokerage: "Baldwin Coastal Realty" },
  });
  const buyer = await createUser({
    role: "buyer",
    auth0_id: "auth0|buyer",
    name: "Mike Smith",
    email: "mike@example.com",
  });
  const deal = await createDeal({ agent_id: agent.id });
  await prisma.deals.update({ where: { id: deal.id }, data: { market } });
  await prisma.deal_participants.create({
    data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
  });
  return { agent, buyer, deal };
}

describe("BAA committed-form registry gating", () => {
  it("resolves the committed BAA with the env template id", () => {
    const cfg = getTemplateConfig("buyer_agency_agreement");
    expect(cfg.templateId).toBe("tpl-baa-real");
    expect(cfg.board).toBe(""); // universal
    expect(cfg.purpose).toBe("baa");
    expect(cfg.roleMapping).toEqual({ buyer: "Buyer", agent: "Agent" });
  });

  it("is NOT live (clear error, not 'unknown') when its template id is unset", () => {
    process.env.DOCUSIGN_TEMPLATE_IDS = "{}";
    resetEnvForTesting();
    expect(() => getTemplateConfig("buyer_agency_agreement")).toThrow(
      TemplateConfigError
    );
    expect(() => getTemplateConfig("buyer_agency_agreement")).toThrow(/template id/i);
    // A genuinely unknown form is a different error.
    expect(() => getTemplateConfig("nope_form")).toThrow(UnknownFormError);
  });

  it("appears in BOTH markets' form lists (universal)", async () => {
    for (const market of ["BIRMINGHAM_AAR", "BALDWIN_GULF_COAST"]) {
      const agent = await createUser({ role: "agent", auth0_id: `auth0|a-${market}` });
      await prisma.users.update({ where: { id: agent.id }, data: { market } });
      const res = await listTemplatesRoute(
        new Request("http://localhost/api/docusign/templates", {
          headers: { authorization: await authHeader(`auth0|a-${market}`, ["agent"]) },
        })
      );
      const keys = ((await res.json()) as { templates: { key: string }[] }).templates.map(
        (t) => t.key
      );
      expect(keys).toContain("buyer_agency_agreement");
    }
  });
});

describe("BAA auto-fill + prefilled send", () => {
  it("auto-fills names on the right roles and prefills agent-entered terms", async () => {
    const { deal } = await seedDeal();
    const auth = await authHeader("auth0|agent", ["agent"]);

    // Agent enters the negotiated terms in prep.
    const putRes = await putTermsRoute(
      authedJson(
        "PUT",
        `http://localhost/api/deals/${deal.id}/contracts/buyer_agency_agreement/terms`,
        { terms: { baa_comp_percent: "3", baa_tail_days: "90", baa_property_location: "Gulf Shores" } },
        auth
      ),
      formCtx(deal.id, "buyer_agency_agreement")
    );
    expect(putRes.status).toBe(200);

    const sendRes = await sendTemplateRoute(
      authedJson(
        "POST",
        `http://localhost/api/deals/${deal.id}/docusign/send-template`,
        { form_key: "buyer_agency_agreement" },
        auth
      ),
      ctx(deal.id)
    );
    expect(sendRes.status).toBe(200);

    expect(fake.lastTemplateCreate?.templateId).toBe("tpl-baa-real");
    const roles = fake.lastTemplateCreate?.roles ?? [];
    const buyer = roles.find((r) => r.roleName === "Buyer");
    const agent = roles.find((r) => r.roleName === "Agent");

    // buyer_name auto-filled on the Buyer role.
    expect(buyer?.tabs?.textTabs).toEqual(
      expect.arrayContaining([{ tabLabel: "buyer_name", value: "Mike Smith" }])
    );
    // agent_name + brokerage_name auto-filled on the Agent role, plus the terms.
    expect(agent?.tabs?.textTabs).toEqual(
      expect.arrayContaining([
        { tabLabel: "agent_name", value: "Sarah Johnson" },
        { tabLabel: "brokerage_name", value: "Baldwin Coastal Realty" },
        { tabLabel: "baa_comp_percent", value: "3" },
        { tabLabel: "baa_tail_days", value: "90" },
        { tabLabel: "baa_property_location", value: "Gulf Shores" },
      ])
    );

    // The document is marked as the BAA so completion flips deals.baa_signed.
    const docId = ((await sendRes.json()) as { document: { id: string } }).document.id;
    const row = await prisma.documents.findUnique({ where: { id: docId } });
    expect(row?.purpose).toBe("baa");
  });

  it("hides auto-sourced keys from prep board fields", async () => {
    const { deal } = await seedDeal();
    const res = await prepRoute(
      new Request(
        `http://localhost/api/deals/${deal.id}/contracts/buyer_agency_agreement/prep`,
        { headers: { authorization: await authHeader("auth0|agent", ["agent"]) } }
      ),
      formCtx(deal.id, "buyer_agency_agreement")
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { board_fields: { key: string }[] };
    const keys = body.board_fields.map((f) => f.key);
    expect(keys).not.toContain("buyer_name");
    expect(keys).not.toContain("agent_name");
    expect(keys).not.toContain("brokerage_name");
    // Agent-entered terms DO show.
    expect(keys).toContain("baa_comp_percent");
    expect(keys).toContain("baa_property_location");
  });

  it("rejects an auto-sourced key submitted as a term", async () => {
    const { deal } = await seedDeal();
    const res = await putTermsRoute(
      authedJson(
        "PUT",
        `http://localhost/api/deals/${deal.id}/contracts/buyer_agency_agreement/terms`,
        { terms: { agent_name: "Hacker" } },
        await authHeader("auth0|agent", ["agent"])
      ),
      formCtx(deal.id, "buyer_agency_agreement")
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/auto-filled/i);
  });
});
