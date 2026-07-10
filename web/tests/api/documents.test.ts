import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import {
  GET as listDocsRoute,
  POST as createDocRoute,
} from "@/app/api/deals/[id]/documents/route";
import { POST as uploadUrlRoute } from "@/app/api/deals/[id]/documents/upload-url/route";
import { GET as downloadUrlRoute } from "@/app/api/documents/[id]/download-url/route";
import { DELETE as deleteDocRoute } from "@/app/api/documents/[id]/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setStorageForTesting, type TestStorage } from "@/lib/blob-storage";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser, createDeal } from "../helpers/factories";

// Capability-URL shapes the storage facade now returns (Vercel Blob, not S3).
const UPLOAD_URL_RE = /^\/api\/storage\/blob-put\?/;
const DOWNLOAD_URL_RE = /^\/api\/storage\/blob-get\?/;

let storage: TestStorage;

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
});

beforeEach(async () => {
  await truncateAll();
  // Fresh recording in-memory Blob backend per test (resets puts/deletes/seeds).
  storage = setStorageForTesting()!;
});

afterEach(() => {
  setStorageForTesting(false);
});

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/deals/[id]/documents/upload-url", () => {
  it("returns a pre-signed PUT url and a deal-scoped key", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const req = new Request(
      `http://localhost/api/deals/${deal.id}/documents/upload-url`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        body: JSON.stringify({
          file_name: "contract.pdf",
          mime_type: "application/pdf",
        }),
      }
    );
    const res = await uploadUrlRoute(req, ctx(deal.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { upload_url: string; s3_key: string };
    expect(body.upload_url).toMatch(UPLOAD_URL_RE);
    expect(body.s3_key).toMatch(new RegExp(`^deals/${deal.id}/\\d+/contract\\.pdf$`));
  });

  it("400 when file_name missing", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const req = new Request(
      `http://localhost/api/deals/${deal.id}/documents/upload-url`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|a", ["agent"]),
        },
        body: JSON.stringify({}),
      }
    );
    const res = await uploadUrlRoute(req, ctx(deal.id));
    expect(res.status).toBe(400);
  });

  it("lets a deal participant (buyer) request a pre-signed url", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const buyer = await createUser({ role: "buyer", auth0_id: "auth0|b" });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });
    const req = new Request(
      `http://localhost/api/deals/${deal.id}/documents/upload-url`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|b", ["buyer"]),
        },
        body: JSON.stringify({
          file_name: "preapproval.pdf",
          mime_type: "application/pdf",
        }),
      }
    );
    const res = await uploadUrlRoute(req, ctx(deal.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { upload_url: string; s3_key: string };
    expect(body.upload_url).toMatch(UPLOAD_URL_RE);
    expect(body.s3_key).toMatch(
      new RegExp(`^deals/${deal.id}/\\d+/preapproval\\.pdf$`)
    );
  });

  it("404 when caller is neither the agent nor a participant", async () => {
    const agent = await createUser({ role: "agent" });
    const stranger = await createUser({ role: "agent", auth0_id: "auth0|other" });
    const deal = await createDeal({ agent_id: agent.id });
    void stranger;
    const req = new Request(
      `http://localhost/api/deals/${deal.id}/documents/upload-url`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await authHeader("auth0|other", ["agent"]),
        },
        body: JSON.stringify({ file_name: "x.pdf" }),
      }
    );
    const res = await uploadUrlRoute(req, ctx(deal.id));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/deals/[id]/documents", () => {
  it("creates a document record with uploader info", async () => {
    const agent = await createUser({
      role: "agent",
      auth0_id: "auth0|a",
      name: "Agent A",
    });
    const deal = await createDeal({ agent_id: agent.id });
    const req = new Request(`http://localhost/api/deals/${deal.id}/documents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({
        name: "contract.pdf",
        s3_key: `deals/${deal.id}/123/contract.pdf`,
        mime_type: "application/pdf",
        file_size: 12345,
      }),
    });
    const res = await createDocRoute(req, ctx(deal.id));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      name: string;
      uploader_name: string;
      file_size: number;
    };
    expect(body.name).toBe("contract.pdf");
    expect(body.uploader_name).toBe("Agent A");
    expect(body.file_size).toBe(12345);
  });

  it("400 when name or s3_key missing", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const req = new Request(`http://localhost/api/deals/${deal.id}/documents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ name: "x" }),
    });
    const res = await createDocRoute(req, ctx(deal.id));
    expect(res.status).toBe(400);
  });

  it("400 when s3_key belongs to a different deal (no cross-deal confirm)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const dealA = await createDeal({ agent_id: agent.id });
    const dealB = await createDeal({ agent_id: agent.id });
    const req = new Request(`http://localhost/api/deals/${dealA.id}/documents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      // Key points at deal B while confirming under deal A.
      body: JSON.stringify({
        name: "sneaky.pdf",
        s3_key: `deals/${dealB.id}/123/sneaky.pdf`,
      }),
    });
    const res = await createDocRoute(req, ctx(dealA.id));
    expect(res.status).toBe(400);
    const count = await prisma.documents.count({ where: { deal_id: dealA.id } });
    expect(count).toBe(0);
  });

  it("lets a deal participant (buyer) confirm an upload (uploaded_by = buyer)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const buyer = await createUser({
      role: "buyer",
      auth0_id: "auth0|b",
      name: "Bob Buyer",
    });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });
    const req = new Request(`http://localhost/api/deals/${deal.id}/documents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|b", ["buyer"]),
      },
      body: JSON.stringify({
        name: "preapproval.pdf",
        s3_key: `deals/${deal.id}/123/preapproval.pdf`,
        mime_type: "application/pdf",
        file_size: 4321,
      }),
    });
    const res = await createDocRoute(req, ctx(deal.id));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      name: string;
      uploaded_by: string;
      uploader_name: string;
    };
    expect(body.name).toBe("preapproval.pdf");
    expect(body.uploaded_by).toBe(buyer.id);
    expect(body.uploader_name).toBe("Bob Buyer");
  });

  it("404 when caller is neither the agent nor a participant", async () => {
    const agent = await createUser({ role: "agent" });
    const stranger = await createUser({ role: "agent", auth0_id: "auth0|other" });
    const deal = await createDeal({ agent_id: agent.id });
    void stranger;
    const req = new Request(`http://localhost/api/deals/${deal.id}/documents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|other", ["agent"]),
      },
      body: JSON.stringify({
        name: "x.pdf",
        s3_key: "k",
      }),
    });
    const res = await createDocRoute(req, ctx(deal.id));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/deals/[id]/documents", () => {
  it("agent and participant can list documents", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const buyer = await createUser({ role: "buyer", auth0_id: "auth0|b" });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.deal_participants.create({
      data: { deal_id: deal.id, user_id: buyer.id, role: "buyer" },
    });
    await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "doc.pdf",
        s3_key: "k",
      },
    });
    const req = new Request(`http://localhost/api/deals/${deal.id}/documents`, {
      headers: { authorization: await authHeader("auth0|b", ["buyer"]) },
    });
    const res = await listDocsRoute(req, ctx(deal.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string }[];
    expect(body.length).toBe(1);
    expect(body[0].name).toBe("doc.pdf");
  });

  it("200 for a TC linked to the deal's owning agent (#167)", async () => {
    const tc = await createUser({ role: "tc", auth0_id: "auth0|tc-linked" });
    const agent = await createUser({ role: "agent" });
    await prisma.users.update({
      where: { id: agent.id },
      data: { tc_user_id: tc.id },
    });
    const deal = await createDeal({ agent_id: agent.id });
    await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "contract.pdf",
        s3_key: "k2",
      },
    });
    const req = new Request(`http://localhost/api/deals/${deal.id}/documents`, {
      headers: { authorization: await authHeader("auth0|tc-linked", ["tc"]) },
    });
    const res = await listDocsRoute(req, ctx(deal.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string }[];
    expect(body.map((d) => d.name)).toEqual(["contract.pdf"]);
  });

  it("200 for admin (#167)", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent" });
    const deal = await createDeal({ agent_id: agent.id });
    const req = new Request(`http://localhost/api/deals/${deal.id}/documents`, {
      headers: { authorization: await authHeader("auth0|admin", ["admin"]) },
    });
    const res = await listDocsRoute(req, ctx(deal.id));
    expect(res.status).toBe(200);
  });

  it("404 for a TC NOT linked to the deal's agent (#167)", async () => {
    await createUser({ role: "tc", auth0_id: "auth0|tc-unlinked" });
    const agent = await createUser({ role: "agent" });
    const deal = await createDeal({ agent_id: agent.id });
    const req = new Request(`http://localhost/api/deals/${deal.id}/documents`, {
      headers: { authorization: await authHeader("auth0|tc-unlinked", ["tc"]) },
    });
    const res = await listDocsRoute(req, ctx(deal.id));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/documents/[id]/download-url", () => {
  it("returns a pre-signed GET url for an accessible document", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const doc = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "x.pdf",
        s3_key: "deals/abc/123/x.pdf",
      },
    });
    const req = new Request(
      `http://localhost/api/documents/${doc.id}/download-url`,
      { headers: { authorization: await authHeader("auth0|a", ["agent"]) } }
    );
    const res = await downloadUrlRoute(req, ctx(doc.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { download_url: string };
    expect(body.download_url).toMatch(DOWNLOAD_URL_RE);
  });

  it("404 for unrelated user", async () => {
    const agent = await createUser({ role: "agent" });
    const stranger = await createUser({ role: "buyer", auth0_id: "auth0|s" });
    const deal = await createDeal({ agent_id: agent.id });
    void stranger;
    const doc = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "x.pdf",
        s3_key: "k",
      },
    });
    const req = new Request(
      `http://localhost/api/documents/${doc.id}/download-url`,
      { headers: { authorization: await authHeader("auth0|s", ["buyer"]) } }
    );
    const res = await downloadUrlRoute(req, ctx(doc.id));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/documents/[id]", () => {
  it("agent owner can delete; record gone, S3 delete attempted", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const doc = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "x.pdf",
        s3_key: "k",
      },
    });
    const req = new Request(`http://localhost/api/documents/${doc.id}`, {
      method: "DELETE",
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await deleteDocRoute(req, ctx(doc.id));
    expect(res.status).toBe(204);

    const row = await prisma.documents.findUnique({ where: { id: doc.id } });
    expect(row).toBeNull();
    // deleteObject is awaited by the route, so the storage call is deterministic
    // by the time the response resolves — no race.
    expect(storage.deletes).toEqual(["k"]);
  });

  it("still 204s and deletes the row when the storage delete throws", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const deal = await createDeal({ agent_id: agent.id });
    const doc = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "x.pdf",
        s3_key: "k",
      },
    });
    storage.failDeletes = true;
    const req = new Request(`http://localhost/api/documents/${doc.id}`, {
      method: "DELETE",
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await deleteDocRoute(req, ctx(doc.id));
    expect(res.status).toBe(204);
    const row = await prisma.documents.findUnique({ where: { id: doc.id } });
    expect(row).toBeNull();
  });

  it("404 when caller is not the owning agent", async () => {
    const agent = await createUser({ role: "agent" });
    const stranger = await createUser({ role: "agent", auth0_id: "auth0|s" });
    const deal = await createDeal({ agent_id: agent.id });
    void stranger;
    const doc = await prisma.documents.create({
      data: {
        deal_id: deal.id,
        uploaded_by: agent.id,
        name: "x.pdf",
        s3_key: "k",
      },
    });
    const req = new Request(`http://localhost/api/documents/${doc.id}`, {
      method: "DELETE",
      headers: { authorization: await authHeader("auth0|s", ["agent"]) },
    });
    const res = await deleteDocRoute(req, ctx(doc.id));
    expect(res.status).toBe(404);
  });
});
