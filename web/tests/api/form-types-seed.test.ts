import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { truncateAll } from "../helpers/db";
import {
  seedFormTypes,
  resolveFormTypeId,
  PURCHASE_AGREEMENT_KEY,
} from "@/lib/form-types-seed";
import { seedForm300, FORM_300_FINGERPRINT } from "@/lib/form-300-seed";
import { isCoreKey } from "@/lib/form-ai/core-keys";

type TypeField = {
  label: string;
  type: string;
  role: string;
  tier: "core" | "common";
  core_key: string | null;
};

// Election keys legitimately repeat across their checkboxes (the deal's scalar
// value picks the box); every other registry key must own at most one field.
const ELECTION_KEYS = new Set(["financing_type", "agency_role"]);

async function purchaseAgreementFields(): Promise<TypeField[]> {
  const row = await prisma.form_types.findUniqueOrThrow({
    where: { key: PURCHASE_AGREEMENT_KEY },
  });
  return row.field_set as unknown as TypeField[];
}

beforeEach(async () => {
  await truncateAll();
});

describe("form_types — purchase_agreement seed", () => {
  it("seeds the position-free purchase_agreement type", async () => {
    const res = await seedFormTypes();
    expect(res).toEqual([{ key: "purchase_agreement", field_count: 79 }]);

    const row = await prisma.form_types.findUniqueOrThrow({
      where: { key: PURCHASE_AGREEMENT_KEY },
    });
    expect(row.label).toBe("Purchase Agreement");
    expect(row.side).toBe("both");
    expect(row.active).toBe(true);
    expect(row.field_count).toBe(79);

    const fields = row.field_set as unknown as TypeField[];
    expect(fields).toHaveLength(79);
    // No coordinates on a TYPE — positions are layout-specific.
    for (const f of fields) {
      expect(f).not.toHaveProperty("pos_x");
      expect(f).not.toHaveProperty("page_number");
    }
  });

  it("every field's core_key is a real registry key, with no scalar collisions", async () => {
    await seedFormTypes();
    const fields = await purchaseAgreementFields();

    const counts = new Map<string, number>();
    for (const f of fields) {
      if (f.core_key === null) continue;
      expect(isCoreKey(f.core_key)).toBe(true);
      counts.set(f.core_key, (counts.get(f.core_key) ?? 0) + 1);
    }
    // A singular identity/fact key cannot be claimed by two fields (would conflate
    // them at fill time). Only enumerated elections may repeat.
    for (const [key, n] of counts) {
      if (!ELECTION_KEYS.has(key)) {
        expect(n, `core_key ${key} used ${n}x`).toBe(1);
      }
    }
    // The election sets ARE present and multi-valued (financing + agency checkboxes).
    expect(counts.get("financing_type")).toBeGreaterThan(1);
    expect(counts.get("agency_role")).toBeGreaterThan(1);
  });

  it("excludes FORM-300-specific elections and keeps the universal field set", async () => {
    await seedFormTypes();
    const labels = new Set((await purchaseAgreementFields()).map((f) => f.label));

    // FORM-300-local elections dropped from the type (they'd be fake misses on
    // other layouts).
    for (const dropped of ["termite_is", "is_septic", "joint_tenancy", "is_condo", "assignable_is"]) {
      expect(labels.has(dropped), `${dropped} should be excluded`).toBe(false);
    }
    // Universal fields kept — including ones the alternates supplied that FORM 300
    // itself lacked (explicit signatures, brokerage).
    for (const kept of [
      "buyer_name",
      "purchase_price",
      "earnest_money_amount",
      "closing_date",
      "buyer1_signature",
      "seller1_signature",
      "buyer_brokerage_name",
    ]) {
      expect(labels.has(kept), `${kept} should be kept`).toBe(true);
    }
  });

  it("is idempotent — re-seeding updates the same row", async () => {
    await seedFormTypes();
    const first = await resolveFormTypeId(PURCHASE_AGREEMENT_KEY);
    await seedFormTypes();
    const second = await resolveFormTypeId(PURCHASE_AGREEMENT_KEY);
    expect(second).toBe(first);
    expect(await prisma.form_types.count()).toBe(1);
  });

  it("links FORM 300 to the type as one known layout (type_id set)", async () => {
    await seedFormTypes();
    const typeId = await resolveFormTypeId(PURCHASE_AGREEMENT_KEY);
    expect(typeId).not.toBeNull();

    const { id } = await seedForm300();
    const known = await prisma.known_forms.findUniqueOrThrow({ where: { id } });
    expect(known.type_id).toBe(typeId);
    expect(known.fingerprint).toBe(FORM_300_FINGERPRINT);
  });

  it("FORM 300 seeds standalone (type_id null) when the type isn't present", async () => {
    const { id } = await seedForm300();
    const known = await prisma.known_forms.findUniqueOrThrow({ where: { id } });
    expect(known.type_id).toBeNull();
  });
});
