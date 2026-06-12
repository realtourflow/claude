import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { StreamingBlobPayloadOutputTypes } from "@smithy/types";
import { POST as sendTemplateRoute } from "@/app/api/deals/[id]/docusign/send-template/route";
import { GET as listTemplatesRoute } from "@/app/api/docusign/templates/route";
import { POST as sendForSignatureRoute } from "@/app/api/deals/[id]/documents/[documentId]/send-for-signature/route";
import { GET as downloadUrlRoute } from "@/app/api/documents/[id]/download-url/route";
import { DELETE as deleteDocumentRoute } from "@/app/api/documents/[id]/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setS3ClientForTesting } from "@/lib/s3";
import {
  setDocusignForTesting,
  type DocusignClient,
  type DocusignSigner,
  type TemplateRole,
} from "@/lib/docusign";
import { prisma } from "@/lib/db";
import { resetEnvForTesting } from "@/lib/env";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser, createDeal } from "../helpers/factories";

const s3Mock = mockClient(S3Client);

const TEMPLATES = {
  buyer_agency_agreement: {
    templateId: "tpl-baa-demo",
    label: "Buyer Agency Agreement",
    roleMapping: { buyer: "Buyer", agent: "Agent" },
    purpose: "baa",
  },
  listing_agreement: {
    templateId: "tpl-listing-demo",
    label: "Listing Agreement",
    roleMapping: { seller: "Seller", agent: "Agent" },
  },
};

type FakeDocusign = DocusignClient & {
  enabledValue: boolean;
  lastCreate?: { docName: string; bytes: Uint8Array; signers: DocusignSigner[] };
  lastTemplateCreate?: { templateId: string; roles: TemplateRole[] };
};

function makeFakeDocusign(): FakeDocusign {
  const fake: FakeDocusign = {
    enabledValue: true,
    enabled() {
      return fake.enabledValue;
    },
    async createEnvelope(docName, bytes, signers) {
      fake.lastCreate = { docName, bytes, signers };
      return "env-adhoc-1";
    },
    async createTemplateEnvelope(templateId, roles) {
      fake.lastTemplateCreate = { templateId, roles };
      return "env-tpl-1";
    },
    async getEnvelopeStatus() {
      return "sent";
    },
  };
  return fake;
}

let fakeDocusign: FakeDocusign;
const savedTemplatesEnv = process.env.DOCUSIGN_TEMPLATES;

function bodyOf(bytes: Uint8Array): StreamingBlobPayloadOutputTypes {
  return {
    transformToByteArray: async () => bytes,
  } as unknown as StreamingBlobPayloadOutputTypes;
}

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
  const client = new S3Client({
    region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  setS3ClientForTesting(client, "test-bucket");
});

beforeEach(async () => {
  await truncateAll();
  s3Mock.reset();
  s3Mock
    .on(GetObjectCommand)
    .resolves({ Body: bodyOf(new Uint8Array([1, 2, 3])) });
  fakeDocusign = makeFakeDocusign();
  setDocusignForTesting(fakeDocusign);
  process.env.DOCUSIGN_TEMPLATES = JSON.stringify(TEMPLATES);
  resetEnvForTesting();
});

afterEach(() => {
  s3Mock.reset();
});

afterAll(() => {
  setDocusignForTesting(undefined);
  setS3ClientForTesting(undefined);
  if (savedTemplatesEnv === undefined) delete process.env.DOCUSIGN_TEMPLATES;
  else process.env.DOCUSIGN_TEMPLATES = savedTemplatesEnv;
  resetEnvForTesting();
});

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function docCtx(id: string, documentId: string) {
  return { params: Promise.resolve({ id, documentId }) };
}

async function seedDealWithBuyer() {
  const agent = await createUser({
    role: "agent",
    auth0_id: "auth0|agent",
    name: "Sarah Johnson",
    email: "sarah@example.com",
  });
  const buyer = await createUser({
    role: "buyer",
    auth0_id: "auth0|buyer",
    name: "Mike Smith",
    email: "mike@example.com",
  });
  const deal = await createDeal({ agent_id: agent.id });
  await prisma.deal_participants.create({
    data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
  });
  return { agent, buyer, deal };
}

function templateSendReq(dealId: string, body: unknown, auth: string) {
  return new Request(
    `http://localhost/api/deals/${dealId}/docusign/send-template`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify(body),
    }
  );
}

describe("POST /api/deals/[id]/docusign/send-template", () => {
  it("auto-assigns participants to template roles and records everything", async () => {
    const { agent, buyer, deal } = await seedDealWithBuyer();
    const res = await sendTemplateRoute(
      templateSendReq(
        deal.id,
        { form_key: "buyer_agency_agreement" },
        await authHeader("auth0|agent", ["agent"])
      ),
      ctx(deal.id)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      envelope_id: string;
      document: { id: string; name: string };
    };
    expect(body.envelope_id).toBe("env-tpl-1");

    // Envelope was template-based with clientUserId on both portal roles.
    expect(fakeDocusign.lastTemplateCreate?.templateId).toBe("tpl-baa-demo");
    const roles = fakeDocusign.lastTemplateCreate?.roles ?? [];
    expect(roles).toHaveLength(2);
    expect(roles.find((r) => r.roleName === "Buyer")).toMatchObject({
      email: "mike@example.com",
      clientUserId: buyer.id,
    });
    expect(roles.find((r) => r.roleName === "Agent")).toMatchObject({
      email: "sarah@example.com",
      clientUserId: agent.id,
    });

    // Placeholder documents row: template label as name, no upload yet,
    // purpose from config, envelope stamped.
    const doc = await prisma.documents.findUnique({
      where: { id: body.document.id },
    });
    expect(doc?.name).toBe("Buyer Agency Agreement");
    expect(doc?.s3_key).toBe("");
    expect(doc?.purpose).toBe("baa");
    expect(doc?.docusign_envelope_id).toBe("env-tpl-1");
    expect(doc?.docusign_status).toBe("sent");

    // One recipient row per role, embedded (user_id + client_user_id set).
    const recipients = await prisma.docusign_recipients.findMany({
      where: { document_id: body.document.id },
      orderBy: { routing_order: "asc" },
    });
    expect(recipients).toHaveLength(2);
    expect(recipients.map((r) => r.role).sort()).toEqual(["Agent", "Buyer"]);
    const buyerRow = recipients.find((r) => r.role === "Buyer");
    expect(buyerRow).toMatchObject({
      envelope_id: "env-tpl-1",
      user_id: buyer.id,
      email: "mike@example.com",
      client_user_id: buyer.id,
      status: "sent",
    });
  });

  it("records an outside override as an email recipient (hybrid)", async () => {
    const { deal } = await seedDealWithBuyer();
    const res = await sendTemplateRoute(
      templateSendReq(
        deal.id,
        {
          form_key: "buyer_agency_agreement",
          assignments: [
            { role_name: "Buyer", email: "out@example.com", name: "Out Sider" },
          ],
        },
        await authHeader("auth0|agent", ["agent"])
      ),
      ctx(deal.id)
    );
    expect(res.status).toBe(200);
    const roles = fakeDocusign.lastTemplateCreate?.roles ?? [];
    const buyerRole = roles.find((r) => r.roleName === "Buyer");
    expect(buyerRole?.email).toBe("out@example.com");
    expect(buyerRole?.clientUserId).toBeUndefined();

    const row = await prisma.docusign_recipients.findFirst({
      where: { role: "Buyer" },
    });
    expect(row?.user_id).toBeNull();
    expect(row?.client_user_id).toBeNull();
    expect(row?.email).toBe("out@example.com");
  });

  it("400s naming the role when no participant can fill it", async () => {
    const { deal } = await seedDealWithBuyer(); // no seller on the deal
    const res = await sendTemplateRoute(
      templateSendReq(
        deal.id,
        { form_key: "listing_agreement" },
        await authHeader("auth0|agent", ["agent"])
      ),
      ctx(deal.id)
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Seller/);
    // Nothing persisted on failure.
    expect(await prisma.documents.count()).toBe(0);
  });

  it("400s clearly for an unconfigured form key", async () => {
    const { deal } = await seedDealWithBuyer();
    const res = await sendTemplateRoute(
      templateSendReq(
        deal.id,
        { form_key: "mystery_form" },
        await authHeader("auth0|agent", ["agent"])
      ),
      ctx(deal.id)
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/mystery_form/);
  });

  it("500s with a clear message when DOCUSIGN_TEMPLATES is malformed", async () => {
    process.env.DOCUSIGN_TEMPLATES = "{broken";
    resetEnvForTesting();
    const { deal } = await seedDealWithBuyer();
    const res = await sendTemplateRoute(
      templateSendReq(
        deal.id,
        { form_key: "buyer_agency_agreement" },
        await authHeader("auth0|agent", ["agent"])
      ),
      ctx(deal.id)
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/not valid JSON/i);
  });

  it("404s for a non-owner agent", async () => {
    const { deal } = await seedDealWithBuyer();
    await createUser({ role: "agent", auth0_id: "auth0|other" });
    const res = await sendTemplateRoute(
      templateSendReq(
        deal.id,
        { form_key: "buyer_agency_agreement" },
        await authHeader("auth0|other", ["agent"])
      ),
      ctx(deal.id)
    );
    expect(res.status).toBe(404);
  });

  it("503s when DocuSign is not configured", async () => {
    fakeDocusign.enabledValue = false;
    const { deal } = await seedDealWithBuyer();
    const res = await sendTemplateRoute(
      templateSendReq(
        deal.id,
        { form_key: "buyer_agency_agreement" },
        await authHeader("auth0|agent", ["agent"])
      ),
      ctx(deal.id)
    );
    expect(res.status).toBe(503);
  });
});

describe("fallback path enrichment (send-for-signature)", () => {
  async function seedUploadedDoc() {
    const seeded = await seedDealWithBuyer();
    const seller = await createUser({
      role: "seller",
      auth0_id: "auth0|seller",
      name: "Jennifer Williams",
      email: "jen@example.com",
    });
    await prisma.deal_participants.create({
      data: { deal_id: seeded.deal.id, user_id: seller.id, role: "seller" },
    });
    const doc = await prisma.documents.create({
      data: {
        deal_id: seeded.deal.id,
        uploaded_by: seeded.agent.id,
        name: "oneoff.pdf",
        s3_key: "deals/x/oneoff.pdf",
      },
    });
    return { ...seeded, seller, doc };
  }

  it("signer_user_ids derives buyer→seller→agent order with recipient rows", async () => {
    const { agent, buyer, seller, deal, doc } = await seedUploadedDoc();
    const req = new Request(
      `http://localhost/api/deals/${deal.id}/documents/${doc.id}/send-for-signature`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|agent", ["agent"]),
        },
        body: JSON.stringify({
          signer_user_ids: [agent.id, seller.id, buyer.id],
        }),
      }
    );
    const res = await sendForSignatureRoute(req, docCtx(deal.id, doc.id));
    expect(res.status).toBe(200);

    const signers = fakeDocusign.lastCreate?.signers ?? [];
    expect(signers.map((s) => s.email)).toEqual([
      "mike@example.com",
      "jen@example.com",
      "sarah@example.com",
    ]);
    expect(signers.map((s) => s.clientUserId)).toEqual([
      buyer.id,
      seller.id,
      agent.id,
    ]);

    const rows = await prisma.docusign_recipients.findMany({
      where: { document_id: doc.id },
      orderBy: { routing_order: "asc" },
    });
    expect(rows.map((r) => r.role)).toEqual(["buyer", "seller", "agent"]);
    expect(rows.map((r) => r.user_id)).toEqual([buyer.id, seller.id, agent.id]);
  });

  it("legacy {signers} still works and records email-only recipient rows", async () => {
    const { deal, doc } = await seedUploadedDoc();
    const req = new Request(
      `http://localhost/api/deals/${deal.id}/documents/${doc.id}/send-for-signature`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|agent", ["agent"]),
        },
        body: JSON.stringify({
          signers: [{ email: "legacy@example.com", name: "Legacy Signer" }],
        }),
      }
    );
    const res = await sendForSignatureRoute(req, docCtx(deal.id, doc.id));
    expect(res.status).toBe(200);

    const rows = await prisma.docusign_recipients.findMany({
      where: { document_id: doc.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: "legacy@example.com",
      user_id: null,
      client_user_id: null,
    });
  });

  it("persists the BAA purpose marker on the fallback path", async () => {
    const { buyer, deal, doc } = await seedUploadedDoc();
    const req = new Request(
      `http://localhost/api/deals/${deal.id}/documents/${doc.id}/send-for-signature`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|agent", ["agent"]),
        },
        body: JSON.stringify({ signer_user_ids: [buyer.id], purpose: "baa" }),
      }
    );
    const res = await sendForSignatureRoute(req, docCtx(deal.id, doc.id));
    expect(res.status).toBe(200);
    const row = await prisma.documents.findUnique({ where: { id: doc.id } });
    expect(row?.purpose).toBe("baa");
  });

  it("rejects a purpose outside the allowlist", async () => {
    const { buyer, deal, doc } = await seedUploadedDoc();
    const req = new Request(
      `http://localhost/api/deals/${deal.id}/documents/${doc.id}/send-for-signature`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|agent", ["agent"]),
        },
        body: JSON.stringify({ signer_user_ids: [buyer.id], purpose: "evil" }),
      }
    );
    const res = await sendForSignatureRoute(req, docCtx(deal.id, doc.id));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/docusign/templates", () => {
  it("lists configured forms for an agent (universal forms, no market set)", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const req = new Request("http://localhost/api/docusign/templates", {
      headers: { authorization: await authHeader("auth0|agent", ["agent"]) },
    });
    const res = await listTemplatesRoute(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { templates: { key: string }[] };
    expect(body.templates).toHaveLength(2);
    expect(body.templates.find((t) => t.key === "buyer_agency_agreement")).toMatchObject({
      key: "buyer_agency_agreement",
      label: "Buyer Agency Agreement",
      roles: ["buyer", "agent"],
      roleMapping: { buyer: "Buyer", agent: "Agent" },
      purpose: "baa",
      board: "",
    });
  });

  it("an agent sees their board's forms plus universal ones — not other boards'", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|bham" });
    await prisma.users.update({
      where: { id: agent.id },
      data: { market: "BIRMINGHAM_AAR" },
    });
    process.env.DOCUSIGN_TEMPLATES = JSON.stringify({
      ...TEMPLATES,
      birmingham_general_financed: {
        templateId: "tpl-bham",
        label: "General/Financed Residential Contract",
        board: "BIRMINGHAM_AAR",
        roleMapping: { buyer: "Buyer", agent: "Agent" },
      },
      baldwin_residential_purchase: {
        templateId: "tpl-baldwin",
        label: "Residential Purchase Agreement",
        board: "BALDWIN_GULF_COAST",
        roleMapping: { buyer: "Buyer", agent: "Agent" },
      },
    });
    resetEnvForTesting();

    const req = new Request("http://localhost/api/docusign/templates", {
      headers: { authorization: await authHeader("auth0|bham", ["agent"]) },
    });
    const res = await listTemplatesRoute(req);
    expect(res.status).toBe(200);
    const keys = ((await res.json()) as { templates: { key: string }[] }).templates.map(
      (t) => t.key
    );
    expect(keys).toContain("birmingham_general_financed");
    expect(keys).toContain("buyer_agency_agreement"); // universal
    expect(keys).not.toContain("baldwin_residential_purchase"); // other board
  });

  it("403s for a non-agent role", async () => {
    await createUser({ role: "buyer", auth0_id: "auth0|buyer-x" });
    const req = new Request("http://localhost/api/docusign/templates", {
      headers: { authorization: await authHeader("auth0|buyer-x", ["buyer"]) },
    });
    const res = await listTemplatesRoute(req);
    expect(res.status).toBe(403);
  });

  it("500s with a clear message when the config is malformed", async () => {
    process.env.DOCUSIGN_TEMPLATES = "{broken";
    resetEnvForTesting();
    await createUser({ role: "agent", auth0_id: "auth0|agent" });
    const req = new Request("http://localhost/api/docusign/templates", {
      headers: { authorization: await authHeader("auth0|agent", ["agent"]) },
    });
    const res = await listTemplatesRoute(req);
    expect(res.status).toBe(500);
    expect(await res.text()).toMatch(/not valid JSON/i);
  });
});

describe("placeholder documents (s3_key='') guards", () => {
  async function seedPlaceholderDoc() {
    const { agent, deal } = await seedDealWithBuyer();
    const doc = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "Buyer Agency Agreement",
        s3_key: "",
        docusign_envelope_id: "env-tpl-9",
        docusign_status: "sent",
      },
    });
    return { agent, deal, doc };
  }

  it("download-url 404s while a template document has no file yet", async () => {
    const { doc } = await seedPlaceholderDoc();
    const req = new Request(
      `http://localhost/api/documents/${doc.id}/download-url`,
      { headers: { authorization: await authHeader("auth0|agent", ["agent"]) } }
    );
    const res = await downloadUrlRoute(req, ctx(doc.id));
    expect(res.status).toBe(404);
    expect(await res.text()).toMatch(/no file/i);
  });

  it("delete succeeds without an S3 call when there is no file", async () => {
    const { doc } = await seedPlaceholderDoc();
    const req = new Request(`http://localhost/api/documents/${doc.id}`, {
      method: "DELETE",
      headers: { authorization: await authHeader("auth0|agent", ["agent"]) },
    });
    const res = await deleteDocumentRoute(req, ctx(doc.id));
    expect(res.status).toBe(204);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
    expect(await prisma.documents.count()).toBe(0);
  });
});
