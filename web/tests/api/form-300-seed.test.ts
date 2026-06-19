import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/factories";
import { seedForm300, FORM_300_FINGERPRINT } from "@/lib/form-300-seed";
import {
  matchFlatKnownForm,
  flatFingerprint,
  copyKnownFields,
  type KnownFormRow,
} from "@/lib/known-forms";

const KNOWN_FETCH = {
  id: true,
  label: true,
  side: true,
  board: true,
  purpose: true,
  field_count: true,
  fields: true,
  role_mapping: true,
} as const;

beforeEach(async () => {
  await truncateAll();
});

describe("FORM 300 known-form seed", () => {
  it("seeds all 88 fields; 5 map to registry core keys, the rest stay form-specific", async () => {
    const { field_count } = await seedForm300();
    expect(field_count).toBe(88);

    const row = await prisma.known_forms.findFirstOrThrow({
      where: { fingerprint: FORM_300_FINGERPRINT },
    });
    expect(row.side).toBe("buy");
    expect(row.board).toBe("BIRMINGHAM_AAR");
    expect(row.page_count).toBe(13);

    const fields = row.fields as Array<{
      detected_name: string;
      core_key: string | null;
      role: string;
    }>;
    expect(fields).toHaveLength(88);
    expect(fields.filter((f) => f.core_key).map((f) => f.core_key).sort()).toEqual([
      "buyer_name",
      "closing_date",
      "earnest_money_amount",
      "legal_description",
      "purchase_price",
    ]);
    // A FORM-300-specific election is cataloged here with NO core key (form-local).
    const election = fields.find((f) => f.detected_name === "appraisal_contingency_is")!;
    expect(election.core_key).toBeNull();
    expect(election.role).toBe("BuyerAgent");
  });

  it("is idempotent — re-seeding updates the same row", async () => {
    const a = await seedForm300();
    const b = await seedForm300();
    expect(b.id).toBe(a.id);
    expect(await prisma.known_forms.count({ where: { fingerprint: FORM_300_FINGERPRINT } })).toBe(1);
  });

  it("recognizes a FLAT upload by content hash, market-scoped and exact-bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    await prisma.known_forms.create({
      data: {
        label: "Flat X",
        side: "buy",
        board: "BIRMINGHAM_AAR",
        purpose: "",
        fingerprint: flatFingerprint(bytes),
        field_count: 0,
        page_count: 1,
        fields: [],
        role_mapping: {},
        active: true,
      },
    });
    expect((await matchFlatKnownForm({ bytes, market: "BIRMINGHAM_AAR" })).known).not.toBeNull();
    // wrong market → no match; different bytes → no match
    expect((await matchFlatKnownForm({ bytes, market: "BALDWIN_GULF_COAST" })).known).toBeNull();
    expect((await matchFlatKnownForm({ bytes: new Uint8Array([9, 9]), market: "BIRMINGHAM_AAR" })).known).toBeNull();
  });

  it("applies the catalog to an upload — 88 fields placed at exact template positions", async () => {
    const agent = await createUser({ role: "agent", auth0_id: "auth0|a" });
    await seedForm300();
    const known = (await prisma.known_forms.findFirstOrThrow({
      where: { fingerprint: FORM_300_FINGERPRINT },
      select: KNOWN_FETCH,
    })) as unknown as KnownFormRow;

    const form = await prisma.uploaded_forms.create({
      data: {
        agent_id: agent.id,
        label: "FORM 300",
        side: "buy",
        source_s3_key: "k",
        source_file_name: "f.pdf",
        attested_by: agent.id,
        attestation_statement: "x",
        file_sha256: "x",
      },
      select: { id: true },
    });

    const counts = await copyKnownFields(form.id, known);
    expect(counts.fieldCount).toBe(88);

    const rows = await prisma.uploaded_form_fields.findMany({ where: { form_id: form.id } });
    expect(rows).toHaveLength(88);

    // A registry core key: accepted (auto-fills from the deal), exact position.
    const buyer = rows.find((r) => r.detected_name === "buyer_name")!;
    expect(buyer.ai_core_key).toBe("buyer_name");
    expect(buyer.decision).toBe("accepted");
    expect(Number(buyer.pos_x)).toBe(185);
    expect(Number(buyer.pos_y)).toBe(707);
    // A form-specific election: placed for the agent to fill, no core key.
    const election = rows.find((r) => r.detected_name === "appraisal_contingency_is")!;
    expect(election.ai_core_key).toBeNull();
  });
});
