import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
} from "vitest";
import { PDFDocument } from "pdf-lib";
import { GET as listForms } from "@/app/api/admin/forms/route";
import { GET as detail, POST as action } from "@/app/api/admin/forms/[id]/route";
import { PATCH as patchField } from "@/app/api/admin/forms/[id]/fields/[fieldId]/route";
import { POST as saveKnown } from "@/app/api/admin/forms/[id]/known/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setStorageForTesting, type TestStorage } from "@/lib/blob-storage";
import { setDocusignForTesting, type DocusignClient } from "@/lib/docusign";
import { MARKETS } from "@/lib/markets";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/factories";

let storage: TestStorage;
let PDF: Uint8Array;
let lastTemplateSigners: unknown[] = [];

// A full DocusignClient fake (createTemplateFromDocument captures its signers).
const fakeDocusign: DocusignClient = {
  enabled: () => true,
  createEnvelope: async () => "env",
  createTemplateEnvelope: async () => "env",
  getEnvelopeStatus: async () => "sent",
  downloadCombinedDocument: async () => new Uint8Array(),
  listRecipients: async () => [],
  createRecipientView: async () => "https://view",
  createTemplateFromDocument: async (input) => {
    lastTemplateSigners = input.signers;
    return "tmpl-xyz";
  },
};


beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
  setDocusignForTesting(fakeDocusign);
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  PDF = await doc.save();
});

afterAll(() => {
  setDocusignForTesting(undefined);
});

beforeEach(async () => {
  await truncateAll();
  storage = setStorageForTesting()!;
  storage.defaultBytes = PDF;
  lastTemplateSigners = [];
});

type FieldSeed = {
  detected_name?: string;
  detected_type?: string;
  ai_core_key?: string | null;
  ai_role?: string | null;
  ai_confidence?: number;
  needs_review?: boolean;
  decision?: string;
  final_core_key?: string | null;
  final_type?: string | null;
};

async function seedForm(
  agentId: string,
  fields: FieldSeed[],
  status = "pending_review"
): Promise<string> {
  const form = await prisma.uploaded_forms.create({
    data: {
      agent_id: agentId,
      label: "Listing",
      side: "sell",
      source_s3_key: `agent-forms/${agentId}/1/listing.pdf`,
      source_file_name: "listing.pdf",
      attested_by: agentId,
      attestation_statement: "I attest.",
      file_sha256: "deadbeef",
      status,
    },
    select: { id: true },
  });
  if (fields.length) {
    await prisma.uploaded_form_fields.createMany({
      data: fields.map((f) => ({
        form_id: form.id,
        detected_name: f.detected_name ?? "field",
        detected_type: f.detected_type ?? "text",
        page_number: 1,
        ai_core_key: f.ai_core_key ?? null,
        ai_role: f.ai_role ?? null,
        ai_confidence: f.ai_confidence ?? 0,
        needs_review: f.needs_review ?? true,
        decision: f.decision ?? "pending",
        final_core_key: f.final_core_key ?? null,
        final_type: f.final_type ?? null,
      })),
    });
  }
  return form.id;
}

const adminHdr = () => authHeader("auth0|admin", ["admin"]);

async function actionReq(id: string, body: object) {
  return new Request(`http://localhost/api/admin/forms/${id}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: await adminHdr() },
    body: JSON.stringify(body),
  });
}

async function patchReq(id: string, fieldId: string, body: object) {
  return new Request(`http://localhost/api/admin/forms/${id}/fields/${fieldId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: await adminHdr() },
    body: JSON.stringify(body),
  });
}

describe("admin form review — access + queue", () => {
  it("403 for a non-admin", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const res = await listForms(
      new Request("http://localhost/api/admin/forms", {
        headers: { authorization: await authHeader("auth0|a", ["agent"]) },
      })
    );
    expect(res.status).toBe(403);
  });

  it("lists pending forms with agent name and counts", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await seedForm(agent.id, [
      { detected_name: "buyer_name", ai_core_key: "buyer_name", needs_review: false },
      { detected_name: "sig", detected_type: "signature", needs_review: true },
    ]);

    const res = await listForms(
      new Request("http://localhost/api/admin/forms", {
        headers: { authorization: await adminHdr() },
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{
      agent_name: string;
      field_count: number;
      needs_review_count: number;
    }>;
    expect(body).toHaveLength(1);
    expect(body[0].agent_name.length).toBeGreaterThan(0);
    expect(body[0].field_count).toBe(2);
    expect(body[0].needs_review_count).toBe(1);
  });

  it("detail returns fields, a preview url, and derived signers", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedForm(agent.id, [
      {
        detected_name: "buyer_name",
        ai_core_key: "buyer_name",
        ai_role: "Buyer",
        needs_review: false,
      },
    ]);

    const res = await detail(
      new Request(`http://localhost/api/admin/forms/${id}`, {
        headers: { authorization: await adminHdr() },
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      preview_url: string;
      fields: unknown[];
      derived_signers: { roleMapping: Record<string, string> };
    };
    expect(body.status).toBe("pending_review");
    expect(body.fields).toHaveLength(1);
    expect(body.preview_url).toMatch(/^\/api\/storage\/blob-get\?/);
    expect(body.derived_signers.roleMapping).toMatchObject({ buyer: "Buyer" });
  });
});

describe("admin form review — correction + approve/reject", () => {
  it("PATCH resolves a flagged field", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedForm(agent.id, [{ detected_name: "price_box", needs_review: true }]);
    const field = await prisma.uploaded_form_fields.findFirstOrThrow({
      where: { form_id: id },
    });

    const res = await patchField(
      await patchReq(id, field.id, {
        final_core_key: "purchase_price",
        final_type: "text",
        final_role: "Buyer",
        decision: "corrected",
      }),
      { params: Promise.resolve({ id, fieldId: field.id }) }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      final_core_key: string;
      needs_review: boolean;
      decision: string;
    };
    expect(body.final_core_key).toBe("purchase_price");
    expect(body.needs_review).toBe(false);
    expect(body.decision).toBe("corrected");
  });

  it("PATCH rejects an unknown core key", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedForm(agent.id, [{ needs_review: true }]);
    const field = await prisma.uploaded_form_fields.findFirstOrThrow({
      where: { form_id: id },
    });
    const res = await patchField(
      await patchReq(id, field.id, { final_core_key: "nonsense", decision: "corrected" }),
      { params: Promise.resolve({ id, fieldId: field.id }) }
    );
    expect(res.status).toBe(400);
  });

  it("blocks approval while a field still needs review", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedForm(agent.id, [{ needs_review: true }]);
    const res = await action(await actionReq(id, { action: "approve" }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(422);
  });

  it("approve creates the DocuSign template, assembles field_map, and flips to ready", async () => {
    const admin = await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedForm(agent.id, [
      {
        detected_name: "buyer_name",
        detected_type: "text",
        ai_core_key: "buyer_name",
        ai_role: "Buyer",
        needs_review: false,
      },
      { detected_name: "sig", detected_type: "signature", needs_review: true },
      { detected_name: "price", detected_type: "text", ai_core_key: null, needs_review: true },
    ]);
    const fields = await prisma.uploaded_form_fields.findMany({ where: { form_id: id } });
    const sig = fields.find((f) => f.detected_name === "sig")!;
    const price = fields.find((f) => f.detected_name === "price")!;

    await patchField(await patchReq(id, sig.id, { decision: "skipped" }), {
      params: Promise.resolve({ id, fieldId: sig.id }),
    });
    await patchField(
      await patchReq(id, price.id, {
        final_core_key: "purchase_price",
        final_type: "text",
        decision: "corrected",
      }),
      { params: Promise.resolve({ id, fieldId: price.id }) }
    );

    const res = await action(await actionReq(id, { action: "approve" }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      docusign_template_id: string;
      field_map: Record<string, { label: string; type: string }>;
      role_mapping: Record<string, string>;
    };
    expect(body.status).toBe("ready");
    expect(body.docusign_template_id).toBe("tmpl-xyz");
    expect(Object.keys(body.field_map).sort()).toEqual(["buyer_name", "purchase_price"]);
    expect(body.role_mapping).toMatchObject({ buyer: "Buyer" });

    // The template was created with the placed tabs.
    expect(lastTemplateSigners.length).toBeGreaterThan(0);

    const row = await prisma.uploaded_forms.findUnique({ where: { id } });
    expect(row?.status).toBe("ready");
    expect(row?.reviewed_by).toBe(admin.id);
    expect(row?.docusign_template_id).toBe("tmpl-xyz");
  });

  it("reject marks the form rejected with notes", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedForm(agent.id, [{ needs_review: true }]);
    const res = await action(
      await actionReq(id, { action: "reject", review_notes: "wrong form" }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);
    const row = await prisma.uploaded_forms.findUnique({ where: { id } });
    expect(row?.status).toBe("rejected");
    expect(row?.review_notes).toBe("wrong form");
  });

  it("409 when approving a form that is not pending", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedForm(agent.id, [], "ready");
    const res = await action(await actionReq(id, { action: "approve" }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(409);
  });
});

describe("admin form review — promote to a company + market combo", () => {
  async function seedBrokerage(name = "ARC Realty") {
    await prisma.brokerages.create({ data: { name, status: "active" } });
  }

  it("promotes an approved form to a combo, then unpromotes it", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await seedBrokerage();
    const id = await seedForm(agent.id, [], "ready");

    const res = await action(
      await actionReq(id, { action: "promote", brokerage: "ARC Realty", market: "HUNTSVILLE" }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      promotions: { brokerage: string; market: string }[];
    };
    expect(body.promotions).toEqual([
      expect.objectContaining({ brokerage: "ARC Realty", market: "HUNTSVILLE" }),
    ]);

    // Idempotent: re-promoting the same combo doesn't duplicate.
    await action(
      await actionReq(id, { action: "promote", brokerage: "ARC Realty", market: "HUNTSVILLE" }),
      { params: Promise.resolve({ id }) }
    );
    expect(await prisma.form_promotions.count({ where: { form_id: id } })).toBe(1);

    const res2 = await action(
      await actionReq(id, { action: "unpromote", brokerage: "ARC Realty", market: "HUNTSVILLE" }),
      { params: Promise.resolve({ id }) }
    );
    expect(res2.status).toBe(200);
    expect(await prisma.form_promotions.count({ where: { form_id: id } })).toBe(0);
  });

  it("promotes to SEVERAL markets in one call (each its own combo; dupes skipped)", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await seedBrokerage();
    const id = await seedForm(agent.id, [], "ready");

    // Pre-existing combo — the batch must skip it, not fail.
    await action(
      await actionReq(id, { action: "promote", brokerage: "ARC Realty", market: "HUNTSVILLE" }),
      { params: Promise.resolve({ id }) }
    );

    const res = await action(
      await actionReq(id, {
        action: "promote",
        brokerage: "ARC Realty",
        markets: ["HUNTSVILLE", "DECATUR", "MOBILE_METRO"],
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { promotions: { market: string }[] };
    expect(body.promotions.map((p) => p.market).sort()).toEqual([
      "DECATUR",
      "HUNTSVILLE",
      "MOBILE_METRO",
    ]);

    // Bulk unpromote removes just the listed combos.
    await action(
      await actionReq(id, {
        action: "unpromote",
        brokerage: "ARC Realty",
        markets: ["HUNTSVILLE", "DECATUR"],
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(
      (await prisma.form_promotions.findMany({ where: { form_id: id } })).map((p) => p.market)
    ).toEqual(["MOBILE_METRO"]);
  });

  it("promotes to ALL 21 markets in one call", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await seedBrokerage();
    const id = await seedForm(agent.id, [], "ready");

    const res = await action(
      await actionReq(id, {
        action: "promote",
        brokerage: "ARC Realty",
        markets: MARKETS.map((m) => m.code),
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);
    expect(await prisma.form_promotions.count({ where: { form_id: id } })).toBe(21);
  });

  it("one invalid market rejects the WHOLE batch (nothing partially created)", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await seedBrokerage();
    const id = await seedForm(agent.id, [], "ready");

    const res = await action(
      await actionReq(id, {
        action: "promote",
        brokerage: "ARC Realty",
        markets: ["HUNTSVILLE", "NOT_A_MARKET"],
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(400);
    expect(await prisma.form_promotions.count({ where: { form_id: id } })).toBe(0);
  });

  it("400 without BOTH company and market (never one or the other)", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await seedBrokerage();
    const id = await seedForm(agent.id, [], "ready");

    for (const body of [
      { action: "promote" },
      { action: "promote", brokerage: "ARC Realty" },
      { action: "promote", market: "HUNTSVILLE" },
    ]) {
      const res = await action(await actionReq(id, body), {
        params: Promise.resolve({ id }),
      });
      expect(res.status).toBe(400);
    }
  });

  it("400 for an unknown market or a company not in the managed list", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await seedBrokerage();
    const id = await seedForm(agent.id, [], "ready");

    const badMarket = await action(
      await actionReq(id, { action: "promote", brokerage: "ARC Realty", market: "NOT_A_MARKET" }),
      { params: Promise.resolve({ id }) }
    );
    expect(badMarket.status).toBe(400);

    const badCompany = await action(
      await actionReq(id, { action: "promote", brokerage: "Nonexistent Realty", market: "HUNTSVILLE" }),
      { params: Promise.resolve({ id }) }
    );
    expect(badCompany.status).toBe(400);
  });

  it("409 when promoting a form that is not approved", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await seedBrokerage();
    const id = await seedForm(agent.id, [{ needs_review: true }]); // pending_review
    const res = await action(
      await actionReq(id, { action: "promote", brokerage: "ARC Realty", market: "HUNTSVILLE" }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(409);
  });

  it("detail exposes the promotions list", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await seedBrokerage();
    const id = await seedForm(agent.id, [], "ready");
    await action(
      await actionReq(id, { action: "promote", brokerage: "ARC Realty", market: "HUNTSVILLE" }),
      { params: Promise.resolve({ id }) }
    );
    const res = await detail(
      new Request(`http://localhost/api/admin/forms/${id}`, {
        headers: { authorization: await adminHdr() },
      }),
      { params: Promise.resolve({ id }) }
    );
    const body = (await res.json()) as {
      promotions: { brokerage: string; market: string }[];
    };
    expect(body.promotions).toEqual([
      expect.objectContaining({ brokerage: "ARC Realty", market: "HUNTSVILLE" }),
    ]);
  });
});

describe("admin save-as-known — promote into the recognition catalog", () => {
  async function knownReq(id: string, hdr: string) {
    return new Request(`http://localhost/api/admin/forms/${id}/known`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: hdr },
      body: "{}",
    });
  }

  it("promotes an approved form and links it back to the source", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedForm(agent.id, [
      {
        detected_name: "buyer_name",
        detected_type: "text",
        ai_core_key: "buyer_name",
        ai_role: "Buyer",
        needs_review: false,
      },
    ]);
    await action(await actionReq(id, { action: "approve" }), {
      params: Promise.resolve({ id }),
    });

    const res = await saveKnown(await knownReq(id, await adminHdr()), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      known_form_id: string;
      fingerprint: string;
    };
    expect(body.fingerprint).toMatch(/^v1:[0-9a-f]{64}$/);

    const kf = await prisma.known_forms.findUnique({
      where: { id: body.known_form_id },
    });
    expect(kf?.source_form_id).toBe(id);
    expect(kf?.fingerprint).toBe(body.fingerprint);
  });

  it("snapshots the admin's corrected field TYPE into the catalog (not the raw type)", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    // Field comes off the extractor as plain text; admin reclassifies it to date.
    const id = await seedForm(agent.id, [
      { detected_name: "close", detected_type: "text", needs_review: true },
    ]);
    const field = await prisma.uploaded_form_fields.findFirstOrThrow({
      where: { form_id: id },
    });
    await patchField(
      await patchReq(id, field.id, {
        final_core_key: "closing_date",
        final_type: "date",
        final_role: "Buyer",
        decision: "corrected",
      }),
      { params: Promise.resolve({ id, fieldId: field.id }) }
    );
    await action(await actionReq(id, { action: "approve" }), {
      params: Promise.resolve({ id }),
    });

    const res = await saveKnown(await knownReq(id, await adminHdr()), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { known_form_id: string };
    const kf = await prisma.known_forms.findUniqueOrThrow({
      where: { id: body.known_form_id },
    });
    const catalog = kf.fields as Array<{
      detected_name: string;
      detected_type: string;
      effective_type: string;
    }>;
    const close = catalog.find((f) => f.detected_name === "close")!;
    expect(close.detected_type).toBe("text"); // raw extractor type preserved
    expect(close.effective_type).toBe("date"); // admin's correction captured
  });

  it("409 when the form is not approved (still pending)", async () => {
    await createUser({ role: "admin", auth0_id: "auth0|admin" });
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedForm(agent.id, [{ needs_review: true }]);
    const res = await saveKnown(await knownReq(id, await adminHdr()), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(409);
  });

  it("403 for a non-admin", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });
    const agent2 = await createUser({ role: "agent", auth0_id: "auth0|b" });
    const id = await seedForm(agent2.id, [], "ready");
    const res = await saveKnown(
      await knownReq(id, await authHeader("auth0|a", ["agent"])),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(403);
  });
});
