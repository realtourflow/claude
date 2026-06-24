import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { POST as sendTemplateRoute } from "@/app/api/deals/[id]/docusign/send-template/route";
import { GET as listTemplatesRoute } from "@/app/api/docusign/templates/route";
import { getTemplateConfig, TemplateConfigError } from "@/lib/docusign-templates";
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

// The Wire Fraud Prevention Notice (Alabama REALTORS statewide UNIFORM) is a
// committed form signed by the deal's consumers — buyers on a buy deal, sellers
// on a sell deal — with no agent signer. Consumer1 required, Consumer2 optional.

type FakeDocusign = DocusignClient & {
  lastTemplateCreate?: { templateId: string; roles: TemplateRole[] };
};
function makeFake(): FakeDocusign {
  const fake: FakeDocusign = {
    enabled: () => true,
    async createEnvelope() {
      return "e";
    },
    async createTemplateEnvelope(templateId, roles) {
      fake.lastTemplateCreate = { templateId, roles };
      return "env-wf-1";
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
  process.env.DOCUSIGN_TEMPLATES = "{}";
  process.env.DOCUSIGN_TEMPLATE_IDS = JSON.stringify({
    al_wire_fraud_notice: "tpl-wf-real",
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
function sendReq(dealId: string, auth: string) {
  return new Request(
    `http://localhost/api/deals/${dealId}/docusign/send-template`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify({ form_key: "al_wire_fraud_notice" }),
    }
  );
}

async function makeAgent() {
  const agent = await createUser({
    role: "agent",
    auth0_id: "auth0|agent",
    name: "Sarah Johnson",
  });
  await prisma.users.update({
    where: { id: agent.id },
    data: { market: "BIRMINGHAM_AAR", brokerage: "Summit Realty" },
  });
  return agent;
}

async function addParticipant(
  dealId: string,
  role: "buyer" | "seller",
  auth0: string,
  name: string
) {
  const u = await createUser({ role, auth0_id: auth0, name });
  await prisma.deal_participants.create({
    data: { deal_id: dealId, user_id: u.id, role },
  });
  return u;
}

describe("wire-fraud notice — registry", () => {
  it("is universal, UNIFORM/E, consumers routing, no agent role", () => {
    const cfg = getTemplateConfig("al_wire_fraud_notice");
    expect(cfg.templateId).toBe("tpl-wf-real");
    expect(cfg.board).toBe("");
    expect(cfg.routing).toBe("consumers");
    expect(cfg.consumerRoles).toEqual(["Consumer1", "Consumer2"]);
    expect(cfg.roleMapping).toEqual({});
  });

  it("is not live (clear error) when its template id is unset", () => {
    process.env.DOCUSIGN_TEMPLATE_IDS = "{}";
    resetEnvForTesting();
    expect(() => getTemplateConfig("al_wire_fraud_notice")).toThrow(
      TemplateConfigError
    );
    expect(() => getTemplateConfig("al_wire_fraud_notice")).toThrow(/template id/i);
  });

  it("shows for both markets (universal)", async () => {
    const agent = await makeAgent();
    void agent;
    const res = await listTemplatesRoute(
      new Request("http://localhost/api/docusign/templates", {
        headers: { authorization: await authHeader("auth0|agent", ["agent"]) },
      })
    );
    const keys = ((await res.json()) as { templates: { key: string }[] }).templates.map(
      (t) => t.key
    );
    expect(keys).toContain("al_wire_fraud_notice");
  });
});

describe("wire-fraud notice — send routing & prefill", () => {
  it("BUY deal: the buyers are the consumers, agent never signs", async () => {
    const agent = await makeAgent();
    const deal = await createDeal({ agent_id: agent.id, type: "buy" });
    await addParticipant(deal.id, "buyer", "auth0|b1", "Aaron Buyer");
    await addParticipant(deal.id, "buyer", "auth0|b2", "Zoe Buyer");

    const res = await sendTemplateRoute(
      sendReq(deal.id, await authHeader("auth0|agent", ["agent"])),
      ctx(deal.id)
    );
    expect(res.status).toBe(200);

    const roles = fake.lastTemplateCreate?.roles ?? [];
    expect(roles.map((r) => r.roleName).sort()).toEqual(["Consumer1", "Consumer2"]);
    // No agent recipient on this form.
    expect(roles.some((r) => r.email === agent.email)).toBe(false);
    // Both consumers are embedded portal signers.
    expect(roles.every((r) => r.clientUserId === r.userId)).toBe(true);

    // consumer_name / consumer_name_2 prefilled on the matching roles, in the
    // same order the recipients were assigned; brokerage on Consumer1.
    const c1 = roles.find((r) => r.roleName === "Consumer1");
    const c2 = roles.find((r) => r.roleName === "Consumer2");
    expect(c1?.tabs?.textTabs).toEqual(
      expect.arrayContaining([
        { tabLabel: "consumer_name", value: c1?.name },
        { tabLabel: "brokerage_name", value: "Summit Realty" },
      ])
    );
    expect(c2?.tabs?.textTabs).toEqual([
      { tabLabel: "consumer_name_2", value: c2?.name },
    ]);
  });

  it("SELL deal: the sellers are the consumers", async () => {
    const agent = await makeAgent();
    const deal = await createDeal({ agent_id: agent.id, type: "sell" });
    const seller = await addParticipant(deal.id, "seller", "auth0|s1", "Sam Seller");

    const res = await sendTemplateRoute(
      sendReq(deal.id, await authHeader("auth0|agent", ["agent"])),
      ctx(deal.id)
    );
    expect(res.status).toBe(200);
    const roles = fake.lastTemplateCreate?.roles ?? [];
    // One consumer -> Consumer1 only; Consumer2 skipped (optional).
    expect(roles.map((r) => r.roleName)).toEqual(["Consumer1"]);
    expect(roles[0]).toMatchObject({ name: "Sam Seller", userId: seller.id });
  });

  it("400s when the deal has no buyer/seller to sign", async () => {
    const agent = await makeAgent();
    const deal = await createDeal({ agent_id: agent.id, type: "buy" });
    const res = await sendTemplateRoute(
      sendReq(deal.id, await authHeader("auth0|agent", ["agent"])),
      ctx(deal.id)
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/buyer or seller/i);
  });
});
