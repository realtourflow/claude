import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { POST as signingUrlRoute } from "@/app/api/deals/[id]/documents/[documentId]/docusign/signing-url/route";
import { GET as listDocumentsRoute } from "@/app/api/deals/[id]/documents/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import {
  setDocusignForTesting,
  type DocusignClient,
} from "@/lib/docusign";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser, createDeal } from "../helpers/factories";

// Embedded signing entry point: a portal user clicks "Sign this document" and
// gets a single-use (~5 min) DocuSign recipient-view URL, generated on click
// and never stored. The recipient-view triple (clientUserId, email, userName)
// must echo the SEND-TIME SNAPSHOT on the recipient row — profiles drift.

type ViewArgs = {
  envelopeId: string;
  clientUserId: string;
  email: string;
  userName: string;
  returnUrl: string;
};

type FakeDocusign = DocusignClient & {
  enabledValue: boolean;
  lastView?: ViewArgs;
};

function makeFakeDocusign(): FakeDocusign {
  const fake: FakeDocusign = {
    enabledValue: true,
    enabled() {
      return fake.enabledValue;
    },
    async createEnvelope() {
      return "e";
    },
    async createTemplateEnvelope() {
      return "e";
    },
    async getEnvelopeStatus() {
      return "sent";
    },
    async downloadCombinedDocument() {
      return new Uint8Array([1]);
    },
    async listRecipients() {
      return [];
    },
    async createRecipientView(envelopeId, opts) {
      fake.lastView = { envelopeId, ...opts };
      return "https://demo.docusign.net/signing/session-1";
    },
  };
  return fake;
}

let fakeDocusign: FakeDocusign;

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
});

beforeEach(async () => {
  await truncateAll();
  fakeDocusign = makeFakeDocusign();
  setDocusignForTesting(fakeDocusign);
});

afterAll(() => {
  setDocusignForTesting(undefined);
});

function ctx(id: string, documentId: string) {
  return { params: Promise.resolve({ id, documentId }) };
}

async function seed(opts: { clientUserId?: boolean; status?: string } = {}) {
  const agent = await createUser({ role: "agent", auth0_id: "auth0|agent" });
  const buyer = await createUser({
    role: "buyer",
    auth0_id: "auth0|buyer",
    name: "Mike Smith",
    email: "live-profile@example.com", // live profile differs from snapshot
  });
  const deal = await createDeal({ agent_id: agent.id });
  await prisma.deal_participants.create({
    data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
  });
  const doc = await prisma.documents.create({
    data: {
      deal_id: deal.id,
      uploaded_by: agent.id,
      name: "Buyer Agency Agreement",
      s3_key: "",
      docusign_envelope_id: "env-sign",
      docusign_status: "sent",
    },
  });
  await prisma.docusign_recipients.create({
    data: {
      document_id: doc.id,
      envelope_id: "env-sign",
      user_id: buyer.id,
      // SNAPSHOT identity at send time (differs from the live profile above).
      email: "mike@example.com",
      name: "Mike Smith (snapshot)",
      role: "Buyer",
      recipient_id: "1",
      routing_order: 1,
      client_user_id: opts.clientUserId === false ? null : buyer.id,
      status: opts.status ?? "sent",
    },
  });
  return { agent, buyer, deal, doc };
}

function req(dealId: string, docId: string, auth: string) {
  return new Request(
    `https://app.example.com/api/deals/${dealId}/documents/${docId}/docusign/signing-url`,
    { method: "POST", headers: { authorization: auth } }
  );
}

describe("POST .../docusign/signing-url", () => {
  it("mints a recipient view echoing the snapshot identity, return URL by role", async () => {
    const { buyer, deal, doc } = await seed();
    const res = await signingUrlRoute(
      req(deal.id, doc.id, await authHeader("auth0|buyer", ["buyer"])),
      ctx(deal.id, doc.id)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toBe("https://demo.docusign.net/signing/session-1");

    expect(fakeDocusign.lastView).toEqual({
      envelopeId: "env-sign",
      clientUserId: buyer.id,
      // Snapshot, NOT the live profile values.
      email: "mike@example.com",
      userName: "Mike Smith (snapshot)",
      returnUrl: `https://app.example.com/buyer/${buyer.id}?signed_doc=${doc.id}`,
    });
  });

  it("404s when the caller has no access to the deal", async () => {
    const { deal, doc } = await seed();
    await createUser({ role: "buyer", auth0_id: "auth0|stranger" });
    const res = await signingUrlRoute(
      req(deal.id, doc.id, await authHeader("auth0|stranger", ["buyer"])),
      ctx(deal.id, doc.id)
    );
    expect(res.status).toBe(404);
  });

  it("404s for a participant who is not a signer on the document", async () => {
    const { deal, doc } = await seed();
    const seller = await createUser({ role: "seller", auth0_id: "auth0|seller" });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: seller.id, role: "seller" },
    });
    const res = await signingUrlRoute(
      req(deal.id, doc.id, await authHeader("auth0|seller", ["seller"])),
      ctx(deal.id, doc.id)
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toMatch(/not a signer/i);
  });

  it("409s for an email recipient (no clientUserId) with an inbox hint", async () => {
    const { deal, doc } = await seed({ clientUserId: false });
    const res = await signingUrlRoute(
      req(deal.id, doc.id, await authHeader("auth0|buyer", ["buyer"])),
      ctx(deal.id, doc.id)
    );
    expect(res.status).toBe(409);
    expect(await res.text()).toMatch(/email|inbox/i);
  });

  it("409s when the recipient already completed", async () => {
    const { deal, doc } = await seed({ status: "completed" });
    const res = await signingUrlRoute(
      req(deal.id, doc.id, await authHeader("auth0|buyer", ["buyer"])),
      ctx(deal.id, doc.id)
    );
    expect(res.status).toBe(409);
  });

  it("409s when the recipient declined", async () => {
    const { deal, doc } = await seed({ status: "declined" });
    const res = await signingUrlRoute(
      req(deal.id, doc.id, await authHeader("auth0|buyer", ["buyer"])),
      ctx(deal.id, doc.id)
    );
    expect(res.status).toBe(409);
  });

  it("503s when DocuSign is not configured", async () => {
    const { deal, doc } = await seed();
    fakeDocusign.enabledValue = false;
    const res = await signingUrlRoute(
      req(deal.id, doc.id, await authHeader("auth0|buyer", ["buyer"])),
      ctx(deal.id, doc.id)
    );
    expect(res.status).toBe(503);
  });
});

describe("GET /api/deals/[id]/documents — my_recipient_status", () => {
  it("each viewer sees their own recipient status; non-signers see null", async () => {
    const { deal, doc } = await seed();
    void doc;

    // The buyer is a signer (status 'sent'); the agent is not on this envelope.
    const asBuyer = await listDocumentsRoute(
      new Request(`http://localhost/api/deals/${deal.id}/documents`, {
        headers: { authorization: await authHeader("auth0|buyer", ["buyer"]) },
      }),
      { params: Promise.resolve({ id: deal.id }) }
    );
    expect(asBuyer.status).toBe(200);
    const buyerRows = (await asBuyer.json()) as { my_recipient_status: string | null }[];
    expect(buyerRows[0].my_recipient_status).toBe("sent");

    const asAgent = await listDocumentsRoute(
      new Request(`http://localhost/api/deals/${deal.id}/documents`, {
        headers: { authorization: await authHeader("auth0|agent", ["agent"]) },
      }),
      { params: Promise.resolve({ id: deal.id }) }
    );
    const agentRows = (await asAgent.json()) as { my_recipient_status: string | null }[];
    expect(agentRows[0].my_recipient_status).toBeNull();
  });
});