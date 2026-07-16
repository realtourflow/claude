import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  getAgentFormConfig,
  listAgentFormsForAgent,
  agentFormViewer,
} from "@/lib/agent-forms";
import { GET as listMyForms, POST as createForm } from "@/app/api/me/forms/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { setStorageForTesting, type TestStorage } from "@/lib/blob-storage";
import { setFieldMapperForTesting } from "@/lib/form-ai/mapper";
import { flatFingerprint } from "@/lib/known-forms";
import type { FieldMapper } from "@/lib/form-ai/types";
import { prisma } from "@/lib/db";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/factories";

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
});

beforeEach(async () => {
  await truncateAll();
});

type SeedOpts = {
  label?: string;
  board?: string;
  templateId?: string | null;
  roleMapping?: Record<string, string>;
  fieldMap?: Record<string, { label: string; type: string; role?: string }>;
  status?: string;
};

async function seedReady(agentId: string, o: SeedOpts = {}): Promise<string> {
  const row = await prisma.uploaded_forms.create({
    data: {
      agent_id: agentId,
      label: o.label ?? "Listing",
      side: "sell",
      board: o.board ?? "",
      status: o.status ?? "ready",
      docusign_template_id: o.templateId === undefined ? "tmpl-1" : o.templateId,
      role_mapping: o.roleMapping ?? { seller: "Seller" },
      field_map:
        o.fieldMap ?? {
          closing_date: { label: "closing_date", type: "text", role: "Seller" },
        },
      source_s3_key: "k",
      source_file_name: "listing.pdf",
      attested_by: agentId,
      attestation_statement: "x",
    },
    select: { id: true },
  });
  return row.id;
}

async function promoteTo(formId: string, brokerage: string, market: string, byUserId: string) {
  await prisma.form_promotions.create({
    data: { form_id: formId, brokerage, market, created_by: byUserId },
  });
}

const viewer = (agentId: string, brokerage = "", markets: string[] = []) => ({
  agentId,
  brokerage,
  markets,
});

describe("agent-forms resolver", () => {
  it("resolves an owner's ready form to exactly the committed TemplateConfig shape", async () => {
    const a = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedReady(a.id);
    const cfg = await getAgentFormConfig(id, viewer(a.id));
    expect(cfg).not.toBeNull();
    expect(cfg).toMatchObject({
      templateId: "tmpl-1",
      label: "Listing",
      board: "",
      purpose: "",
      roleMapping: { seller: "Seller" },
    });
    expect(cfg!.fieldMap.closing_date).toMatchObject({
      label: "closing_date",
      type: "text",
    });
    // Shape parity: exactly the committed-config keys, nothing extra.
    expect(Object.keys(cfg!).sort()).toEqual([
      "board",
      "consumerRoles",
      "fieldMap",
      "label",
      "purpose",
      "roleMapping",
      "routing",
      "templateId",
    ]);
  });

  it("returns null for a pending or template-less form", async () => {
    const a = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const pending = await seedReady(a.id, { status: "pending_review", templateId: null });
    expect(await getAgentFormConfig(pending, viewer(a.id))).toBeNull();
  });

  it("hides another agent's non-promoted form", async () => {
    const a = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const b = await createUser({ role: "agent", auth0_id: "auth0|b" });
    const id = await seedReady(a.id);
    expect(
      await getAgentFormConfig(id, viewer(b.id, "ARC Realty", ["BIRMINGHAM_AAR"]))
    ).toBeNull();
  });

  it("a promotion grants access ONLY to a matching company + market profile", async () => {
    const a = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const b = await createUser({ role: "agent", auth0_id: "auth0|b" });
    const id = await seedReady(a.id);
    await promoteTo(id, "ARC Realty", "HUNTSVILLE", a.id);

    // Exact match: same company AND the combo market is one of the viewer's markets.
    expect(
      await getAgentFormConfig(id, viewer(b.id, "ARC Realty", ["HUNTSVILLE"]))
    ).not.toBeNull();
    // Multi-market agent whose second market matches.
    expect(
      await getAgentFormConfig(id, viewer(b.id, "ARC Realty", ["MOBILE_METRO", "HUNTSVILLE"]))
    ).not.toBeNull();
    // Same company, wrong market → hidden.
    expect(
      await getAgentFormConfig(id, viewer(b.id, "ARC Realty", ["MOBILE_METRO"]))
    ).toBeNull();
    // Right market, different company → hidden.
    expect(
      await getAgentFormConfig(id, viewer(b.id, "RE/MAX", ["HUNTSVILLE"]))
    ).toBeNull();
    // No profile at all → hidden.
    expect(await getAgentFormConfig(id, viewer(b.id))).toBeNull();
  });

  it("agentFormViewer reads brokerage + markets off the users row", async () => {
    const a = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await prisma.users.update({
      where: { id: a.id },
      data: { brokerage: "ARC Realty", markets: ["HUNTSVILLE", "DECATUR"] },
    });
    const v = await agentFormViewer(a.id);
    expect(v).toEqual({
      agentId: a.id,
      brokerage: "ARC Realty",
      markets: ["HUNTSVILLE", "DECATUR"],
    });
  });

  it("a NEW agent matching the combo sees the form with no manual push", async () => {
    const a = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedReady(a.id, { label: "ARC Purchase Agreement" });
    await promoteTo(id, "ARC Realty", "HUNTSVILLE", a.id);

    // Agent onboards AFTER the promotion exists…
    const newbie = await createUser({ role: "agent", auth0_id: "auth0|new" });
    await prisma.users.update({
      where: { id: newbie.id },
      data: { brokerage: "ARC Realty", markets: ["HUNTSVILLE"] },
    });
    // …and immediately sees it through the live profile match.
    const list = await listAgentFormsForAgent(await agentFormViewer(newbie.id));
    expect(list.map((f) => f.label)).toContain("ARC Purchase Agreement");
  });

  it("lists the caller's sendable forms in the picker shape", async () => {
    const a = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await seedReady(a.id, { label: "Mine" });
    const list = await listAgentFormsForAgent(viewer(a.id));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ label: "Mine", board: "" });
    expect(list[0].roles).toEqual(["seller"]);
  });
});

// #295 — the My Forms list is the agent's only view of a review outcome, but it
// never returned review_notes, so a rejected form showed a bare "Rejected" chip
// with no reason. The list endpoint now selects and returns review_notes.
describe("GET /api/me/forms — surfaces review_notes (#295)", () => {
  async function seedOwned(
    agentId: string,
    o: { status: string; review_notes?: string | null; label?: string }
  ): Promise<void> {
    await prisma.uploaded_forms.create({
      data: {
        agent_id: agentId,
        label: o.label ?? "Purchase Agreement",
        side: "buy",
        status: o.status,
        review_notes: o.review_notes ?? null,
        source_s3_key: "k",
        source_file_name: "pa.pdf",
        attested_by: agentId,
        attestation_statement: "x",
        file_sha256: "deadbeef",
      },
    });
  }

  async function listReq(sub: string): Promise<Response> {
    return listMyForms(
      new Request("http://localhost/api/me/forms", {
        headers: { authorization: await authHeader(sub, ["agent"]) },
      })
    );
  }

  it("returns the admin's review_notes for a rejected form", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await seedOwned(agent.id, { status: "rejected", review_notes: "signature block cut off" });

    const res = await listReq("auth0|a");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ status: string; review_notes: string | null }>;
    expect(body).toHaveLength(1);
    expect(body[0].status).toBe("rejected");
    expect(body[0].review_notes).toBe("signature block cut off");
  });

  it("returns review_notes as null when there is no note", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await seedOwned(agent.id, { status: "ready" });

    const res = await listReq("auth0|a");
    const body = (await res.json()) as Array<{ review_notes: string | null }>;
    expect(body).toHaveLength(1);
    expect(body[0].review_notes).toBeNull();
  });
});

// #287 — a corrupt / non-PDF upload (e.g. a JPEG renamed .pdf, or a truncated
// PDF) used to throw an unexplained 500 AND orphan the stored blob, because the
// route's catch only handled the two typed errors and rethrew everything else
// WITHOUT deleting the object. The bundle path never parsed at all, so a corrupt
// bundle was accepted (201, pending_split) and only failed later at admin split.
// The route now validates the bytes parse as a PDF right after fetching them —
// one gate covering BOTH the flat and bundle paths.
describe("POST /api/me/forms — corrupt/non-PDF upload (#287)", () => {
  let storage: TestStorage;
  let FILLABLE: Uint8Array;
  let FLAT: Uint8Array;

  // A non-PDF payload: JPEG magic bytes + filler. pdf-lib's load() throws (there
  // is no %PDF header) — exactly the upload that used to 500 and orphan the blob.
  const GARBAGE = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x6e, 0x6f, 0x74, 0x2d, 0x61, 0x2d, 0x70, 0x64, 0x66,
  ]);

  // Deterministic stand-in for the real Claude mapper (fillable regression path):
  // maps the first field, declines the rest. Guarantees no real Anthropic call.
  const fakeMapper: FieldMapper = {
    proposeMappings: async ({ fields }) =>
      fields.map((_, i) =>
        i === 0
          ? { coreKey: "buyer_name", role: "Buyer", confidence: 0.95, rationale: "named buyer" }
          : { coreKey: null, role: null, confidence: 0, rationale: "" }
      ),
  };

  beforeAll(async () => {
    const fdoc = await PDFDocument.create();
    const page = fdoc.addPage([612, 792]);
    fdoc
      .getForm()
      .createTextField("buyer_name")
      .addToPage(page, { x: 72, y: 700, width: 200, height: 18 });
    FILLABLE = await fdoc.save();

    const gdoc = await PDFDocument.create();
    gdoc.addPage([612, 792]);
    FLAT = await gdoc.save();
  });

  beforeEach(() => {
    // truncateAll already ran (top-level beforeEach). Install a fresh recording
    // Blob backend + the fake mapper; both are torn down in afterEach.
    storage = setStorageForTesting()!;
    setFieldMapperForTesting(fakeMapper);
  });

  afterEach(() => {
    setStorageForTesting(false);
    setFieldMapperForTesting(undefined);
  });

  // Uploading requires a declared company + market (the profile gate) — give the
  // agent both so the corrupt-PDF gate (not the profile gate) is what fires.
  async function onboard(agentId: string) {
    await prisma.users.update({
      where: { id: agentId },
      data: { brokerage: "ARC Realty", market: "BIRMINGHAM_AAR", markets: ["BIRMINGHAM_AAR"] },
    });
  }

  const KEY = (agentId: string) => `agent-forms/${agentId}/123/listing.pdf`;

  async function postForm(agentId: string, sub: string, extra: Record<string, unknown> = {}) {
    return new Request("http://localhost/api/me/forms", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: await authHeader(sub, ["agent"]),
      },
      body: JSON.stringify({
        label: "Listing",
        side: "sell",
        file_name: "listing.pdf",
        s3_key: KEY(agentId),
        mime_type: "application/pdf",
        attestation: true,
        ...extra,
      }),
    });
  }

  it("Case 1: a non-PDF on the flat path → 400 friendly message, deletes the blob, persists nothing", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await onboard(agent.id);
    storage.seed(KEY(agent.id), GARBAGE);

    const res = await createForm(await postForm(agent.id, "auth0|a"));
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/readable PDF/);
    // The orphan bug: the blob must be deleted, and nothing persisted.
    expect(storage.deletes).toContain(KEY(agent.id));
    expect(await prisma.uploaded_forms.count()).toBe(0);
  });

  it("Case 2: a non-PDF with bundle:true → 400 + blob deleted (no stuck pending_split)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await onboard(agent.id);
    storage.seed(KEY(agent.id), GARBAGE);

    const res = await createForm(await postForm(agent.id, "auth0|a", { bundle: true }));
    // Validated at UPLOAD time, not deferred to admin split.
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/readable PDF/);
    expect(storage.deletes).toContain(KEY(agent.id));
    expect(await prisma.uploaded_forms.count()).toBe(0);
  });

  it("Case 3a: a valid FILLABLE PDF still returns 201 (regression — blob kept)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await onboard(agent.id);
    storage.seed(KEY(agent.id), FILLABLE);

    const res = await createForm(await postForm(agent.id, "auth0|a"));
    expect(res.status).toBe(201);
    expect(storage.deletes).not.toContain(KEY(agent.id));
    expect(await prisma.uploaded_forms.count()).toBe(1);
  });

  it("Case 3b: a valid FLAT PDF (recognized) still returns 201 (regression — no vision/AI)", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await onboard(agent.id);
    storage.seed(KEY(agent.id), FLAT);
    // A recognized flat form reaches 201 with no AI mapper and no vision — a
    // deterministic proof the PDF gate passes a valid FLAT upload untouched. (The
    // flat + form_type → vision 201 path is covered by forms-vision-detect.test.ts.)
    await prisma.known_forms.create({
      data: {
        label: "Known Flat",
        side: "sell",
        board: "",
        purpose: "",
        fingerprint: flatFingerprint(FLAT),
        field_count: 1,
        page_count: 1,
        fields: [
          {
            detected_name: "buyer_name",
            detected_type: "text",
            effective_type: "text",
            page_number: 1,
            pos_x: 72,
            pos_y: 700,
            width: 200,
            height: 18,
            core_key: "buyer_name",
            role: "Buyer",
            needs_review: false,
          },
        ],
        role_mapping: { buyer: "Buyer" },
        active: true,
      },
    });

    const res = await createForm(await postForm(agent.id, "auth0|a"));
    expect(res.status).toBe(201);
    expect(storage.deletes).not.toContain(KEY(agent.id));
    expect(await prisma.uploaded_forms.count()).toBe(1);
  });
});
