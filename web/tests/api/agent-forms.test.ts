import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  getAgentFormConfig,
  listAgentFormsForAgent,
  agentFormViewer,
} from "@/lib/agent-forms";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTestSigner } from "../helpers/jwt";
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
