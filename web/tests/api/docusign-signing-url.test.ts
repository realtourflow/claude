import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { POST as signingUrlRoute } from "@/app/api/deals/[id]/documents/[documentId]/docusign/signing-url/route";
import { POST as refreshRoute } from "@/app/api/deals/[id]/documents/[documentId]/docusign/refresh/route";
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

// ── Issue #165: the OWNING AGENT as an embedded signer ──────────────────────
// Several committed templates route the agent as a REQUIRED embedded
// recipient (buyer_agency_agreement → Agent, listing agreements → Listing
// Agent, form_300_birmingham → BuyerAgent): assignTemplateRoles gives every
// matched deal person — the agent included — a clientUserId, so DocuSign
// never emails them. The same signing-url route must mint the agent's
// recipient view, and the documents list must surface the agent's own
// pending status so DealDetail's Documents tab can show its Sign button.

async function seedAgentSigner(
  opts: { recipientRow?: boolean; status?: string } = {}
) {
  const agent = await createUser({
    role: "agent",
    auth0_id: "auth0|agent",
    name: "Paula Agent",
    email: "live-agent@example.com", // live profile differs from snapshot
  });
  const deal = await createDeal({ agent_id: agent.id });
  const doc = await prisma.documents.create({
    data: {
      deal_id: deal.id,
      uploaded_by: agent.id,
      name: "Buyer Agency Agreement",
      s3_key: "",
      docusign_envelope_id: "env-agent",
      docusign_status: "sent",
    },
  });
  if (opts.recipientRow !== false) {
    await prisma.docusign_recipients.create({
      data: {
        document_id: doc.id,
        envelope_id: "env-agent",
        user_id: agent.id,
        // SNAPSHOT identity at send time.
        email: "paula@example.com",
        name: "Paula Agent (snapshot)",
        role: "Agent",
        recipient_id: "2",
        routing_order: 2,
        client_user_id: agent.id,
        status: opts.status ?? "sent",
      },
    });
  }
  return { agent, deal, doc };
}

describe("agent embedded signing (#165)", () => {
  it("mints the agent's recipient view with the agent deal-page return URL", async () => {
    const { agent, deal, doc } = await seedAgentSigner();
    const res = await signingUrlRoute(
      req(deal.id, doc.id, await authHeader("auth0|agent", ["agent"])),
      ctx(deal.id, doc.id)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toBe("https://demo.docusign.net/signing/session-1");

    expect(fakeDocusign.lastView).toEqual({
      envelopeId: "env-agent",
      clientUserId: agent.id,
      // Snapshot, NOT the live profile values.
      email: "paula@example.com",
      userName: "Paula Agent (snapshot)",
      // Agents return to the deal page (not a portal).
      returnUrl: `https://app.example.com/agent/deals/${deal.id}?signed_doc=${doc.id}`,
    });
  });

  it("documents list surfaces the agent's own pending status (drives the Sign button)", async () => {
    const { deal } = await seedAgentSigner();
    const res = await listDocumentsRoute(
      new Request(`http://localhost/api/deals/${deal.id}/documents`, {
        headers: { authorization: await authHeader("auth0|agent", ["agent"]) },
      }),
      { params: Promise.resolve({ id: deal.id }) }
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { my_recipient_status: string | null }[];
    expect(rows[0].my_recipient_status).toBe("sent");
  });

  it("after signing, refresh flips the agent recipient to completed and signing-url 409s", async () => {
    const { deal, doc } = await seedAgentSigner();
    const auth = await authHeader("auth0|agent", ["agent"]);

    // DocuSign now reports the agent's recipient completed (envelope itself
    // still in flight — other signers pending).
    fakeDocusign.listRecipients = async () => [
      {
        email: "paula@example.com",
        name: "Paula Agent (snapshot)",
        status: "completed",
        recipientId: "2",
      },
    ];
    const refreshRes = await refreshRoute(
      new Request(
        `https://app.example.com/api/deals/${deal.id}/documents/${doc.id}/docusign/refresh`,
        { method: "POST", headers: { authorization: auth } }
      ),
      ctx(deal.id, doc.id)
    );
    expect(refreshRes.status).toBe(200);

    // The list now shows the terminal status (the Sign button disappears)…
    const listRes = await listDocumentsRoute(
      new Request(`http://localhost/api/deals/${deal.id}/documents`, {
        headers: { authorization: auth },
      }),
      { params: Promise.resolve({ id: deal.id }) }
    );
    const rows = (await listRes.json()) as { my_recipient_status: string | null }[];
    expect(rows[0].my_recipient_status).toBe("completed");

    // …and a repeat mint is refused.
    const again = await signingUrlRoute(req(deal.id, doc.id, auth), ctx(deal.id, doc.id));
    expect(again.status).toBe(409);
    expect(await again.text()).toMatch(/already completed/i);
  });

  it("404s for an agent with no recipient row on the document (no button, no URL)", async () => {
    const { deal, doc } = await seedAgentSigner({ recipientRow: false });
    const res = await signingUrlRoute(
      req(deal.id, doc.id, await authHeader("auth0|agent", ["agent"])),
      ctx(deal.id, doc.id)
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toMatch(/not a signer/i);
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