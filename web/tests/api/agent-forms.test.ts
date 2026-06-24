import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { getAgentFormConfig, listAgentFormsForAgent } from "@/lib/agent-forms";
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
  promoted?: boolean;
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
      promoted: o.promoted ?? false,
      source_s3_key: "k",
      source_file_name: "listing.pdf",
      attested_by: agentId,
      attestation_statement: "x",
    },
    select: { id: true },
  });
  return row.id;
}

describe("agent-forms resolver", () => {
  it("resolves an owner's ready form to exactly the committed TemplateConfig shape", async () => {
    const a = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const id = await seedReady(a.id);
    const cfg = await getAgentFormConfig(id, a.id, "");
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
    expect(await getAgentFormConfig(pending, a.id, "")).toBeNull();
  });

  it("hides another agent's non-promoted form", async () => {
    const a = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const b = await createUser({ role: "agent", auth0_id: "auth0|b" });
    const id = await seedReady(a.id);
    expect(await getAgentFormConfig(id, b.id, "")).toBeNull();
  });

  it("routes a promoted form by market (board === '' || board === market)", async () => {
    const a = await createUser({ role: "agent", auth0_id: "auth0|a" });
    const b = await createUser({ role: "agent", auth0_id: "auth0|b" });
    const id = await seedReady(a.id, { promoted: true, board: "BALDWIN" });
    expect(await getAgentFormConfig(id, b.id, "BALDWIN")).not.toBeNull();
    expect(await getAgentFormConfig(id, b.id, "BIRMINGHAM")).toBeNull();
  });

  it("lists the caller's sendable forms in the picker shape", async () => {
    const a = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await seedReady(a.id, { label: "Mine" });
    const list = await listAgentFormsForAgent(a.id, "");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ label: "Mine", board: "" });
    expect(list[0].roles).toEqual(["seller"]);
  });
});
