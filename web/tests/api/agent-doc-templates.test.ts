import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import {
  GET as listRoute,
  POST as createRoute,
} from "@/app/api/me/doc-templates/route";
import { POST as uploadUrlRoute } from "@/app/api/me/doc-templates/upload-url/route";
import {
  PATCH as patchRoute,
  DELETE as deleteRoute,
} from "@/app/api/me/doc-templates/[docId]/route";
import { GET as downloadUrlRoute } from "@/app/api/me/doc-templates/[docId]/download-url/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setS3ClientForTesting } from "@/lib/s3";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/factories";

const s3Mock = mockClient(S3Client);

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);

  // Real S3Client with fake creds so the local SDK signer can compute URLs;
  // the underlying HTTP send is mocked so nothing ever hits S3.
  const client = new S3Client({
    region: "us-east-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  setS3ClientForTesting(client, "test-bucket");
});

beforeEach(async () => {
  await truncateAll();
  s3Mock.reset();
  s3Mock.on(DeleteObjectCommand).resolves({});
  s3Mock.on(PutObjectCommand).resolves({});
  s3Mock.on(GetObjectCommand).resolves({});
});

afterEach(() => {
  s3Mock.reset();
});

function ctx(docId: string) {
  return { params: Promise.resolve({ docId }) };
}

type ApiDoc = {
  id: string;
  agent_id: string;
  name: string;
  doc_type: string;
  file_name: string;
  s3_key: string;
  mime_type: string;
  file_size: number;
  notes: string | null;
  created_at: string;
};

// Helper: insert a template row directly for the given agent.
async function seedTemplate(
  agentId: string,
  overrides: Partial<{
    name: string;
    doc_type: string;
    file_name: string;
    s3_key: string;
    notes: string | null;
  }> = {}
) {
  return prisma.agent_doc_templates.create({
    data: {
      agent_id: agentId,
      name: overrides.name ?? "Buyer Agency Agreement",
      doc_type: overrides.doc_type ?? "baa",
      file_name: overrides.file_name ?? "baa.pdf",
      s3_key: overrides.s3_key ?? `agent-templates/${agentId}/123/baa.pdf`,
      mime_type: "application/pdf",
      file_size: 4096,
      notes: overrides.notes ?? null,
    },
    select: { id: true, agent_id: true, s3_key: true },
  });
}

describe("POST /api/me/doc-templates/upload-url", () => {
  it("returns a pre-signed PUT url and an agent-scoped key", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const req = new Request("http://localhost/api/me/doc-templates/upload-url", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ file_name: "baa.pdf", mime_type: "application/pdf" }),
    });
    const res = await uploadUrlRoute(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { upload_url: string; s3_key: string };
    expect(body.upload_url).toMatch(/^https:\/\/.*\.s3\..+\.amazonaws\.com\//);
    expect(body.s3_key).toMatch(
      new RegExp(`^agent-templates/${agent.id}/\\d+/baa\\.pdf$`)
    );
  });

  it("400 when file_name missing", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const req = new Request("http://localhost/api/me/doc-templates/upload-url", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({}),
    });
    const res = await uploadUrlRoute(req);
    expect(res.status).toBe(400);
  });

  it("401 without a token", async () => {
    const req = new Request("http://localhost/api/me/doc-templates/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file_name: "x.pdf" }),
    });
    const res = await uploadUrlRoute(req);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/me/doc-templates", () => {
  it("inserts a row and returns the ApiDoc shape for the caller", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const req = new Request("http://localhost/api/me/doc-templates", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({
        name: "Buyer Agency Agreement",
        doc_type: "baa",
        file_name: "baa.pdf",
        s3_key: `agent-templates/${agent.id}/123/baa.pdf`,
        mime_type: "application/pdf",
        file_size: 4096,
        notes: "default copy",
      }),
    });
    const res = await createRoute(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as ApiDoc;
    expect(body.id).toBeTruthy();
    expect(body.agent_id).toBe(agent.id);
    expect(body.name).toBe("Buyer Agency Agreement");
    expect(body.doc_type).toBe("baa");
    expect(body.file_name).toBe("baa.pdf");
    expect(body.mime_type).toBe("application/pdf");
    expect(body.file_size).toBe(4096);
    expect(body.notes).toBe("default copy");
    expect(typeof body.created_at).toBe("string");
  });

  it("400 when name, doc_type, or s3_key missing", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const req = new Request("http://localhost/api/me/doc-templates", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ name: "x", doc_type: "baa" }),
    });
    const res = await createRoute(req);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/me/doc-templates", () => {
  it("returns only the caller's templates (agent-scoped)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const other = await createUser({ role: "agent", auth0_id: "auth0|other" });
    await seedTemplate(agent.id, { name: "Mine" });
    await seedTemplate(other.id, { name: "Not Mine" });

    const req = new Request("http://localhost/api/me/doc-templates", {
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await listRoute(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiDoc[];
    expect(body.length).toBe(1);
    expect(body[0].name).toBe("Mine");
    expect(body[0].agent_id).toBe(agent.id);
    expect(body[0].file_size).toBe(4096);
  });

  it("401 without a token", async () => {
    const req = new Request("http://localhost/api/me/doc-templates");
    const res = await listRoute(req);
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/me/doc-templates/[docId]", () => {
  it("partially updates name and notes for the owner", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const tpl = await seedTemplate(agent.id, { name: "Old", notes: "old note" });

    const req = new Request(`http://localhost/api/me/doc-templates/${tpl.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ name: "New", notes: null }),
    });
    const res = await patchRoute(req, ctx(tpl.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiDoc;
    expect(body.name).toBe("New");
    expect(body.notes).toBeNull();
  });

  it("leaves notes untouched when not provided", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const tpl = await seedTemplate(agent.id, { name: "Old", notes: "keep me" });

    const req = new Request(`http://localhost/api/me/doc-templates/${tpl.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|a", ["agent"]),
      },
      body: JSON.stringify({ name: "Renamed" }),
    });
    const res = await patchRoute(req, ctx(tpl.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiDoc;
    expect(body.name).toBe("Renamed");
    expect(body.notes).toBe("keep me");
  });

  it("404 when caller is not the owning agent", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await createUser({ role: "agent", auth0_id: "auth0|other" });
    const tpl = await seedTemplate(agent.id);

    const req = new Request(`http://localhost/api/me/doc-templates/${tpl.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader("auth0|other", ["agent"]),
      },
      body: JSON.stringify({ name: "Hijack" }),
    });
    const res = await patchRoute(req, ctx(tpl.id));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/me/doc-templates/[docId]", () => {
  it("owner can delete; row gone", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const tpl = await seedTemplate(agent.id);

    const req = new Request(`http://localhost/api/me/doc-templates/${tpl.id}`, {
      method: "DELETE",
      headers: { authorization: await authHeader("auth0|a", ["agent"]) },
    });
    const res = await deleteRoute(req, ctx(tpl.id));
    expect(res.status).toBe(204);

    const row = await prisma.agent_doc_templates.findUnique({
      where: { id: tpl.id },
    });
    expect(row).toBeNull();
  });

  it("404 when caller is not the owning agent", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await createUser({ role: "agent", auth0_id: "auth0|other" });
    const tpl = await seedTemplate(agent.id);

    const req = new Request(`http://localhost/api/me/doc-templates/${tpl.id}`, {
      method: "DELETE",
      headers: { authorization: await authHeader("auth0|other", ["agent"]) },
    });
    const res = await deleteRoute(req, ctx(tpl.id));
    expect(res.status).toBe(404);

    // Row still present — not the owner.
    const row = await prisma.agent_doc_templates.findUnique({
      where: { id: tpl.id },
    });
    expect(row).not.toBeNull();
  });
});

describe("GET /api/me/doc-templates/[docId]/download-url", () => {
  it("returns a pre-signed GET url for the owner's template", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const tpl = await seedTemplate(agent.id);

    const req = new Request(
      `http://localhost/api/me/doc-templates/${tpl.id}/download-url`,
      { headers: { authorization: await authHeader("auth0|a", ["agent"]) } }
    );
    const res = await downloadUrlRoute(req, ctx(tpl.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { download_url: string };
    expect(body.download_url).toMatch(/^https:\/\/.*amazonaws\.com\//);
  });

  it("404 for a template the caller does not own", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await createUser({ role: "agent", auth0_id: "auth0|other" });
    const tpl = await seedTemplate(agent.id);

    const req = new Request(
      `http://localhost/api/me/doc-templates/${tpl.id}/download-url`,
      { headers: { authorization: await authHeader("auth0|other", ["agent"]) } }
    );
    const res = await downloadUrlRoute(req, ctx(tpl.id));
    expect(res.status).toBe(404);
  });
});
