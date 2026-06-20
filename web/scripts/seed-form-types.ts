/**
 * Seed (or re-seed) the document-TYPE catalog and relink FORM 300 to the
 * purchase_agreement type. Idempotent. Seeds types FIRST so seedForm300 resolves
 * and stores its type_id.
 *   Run from web/:  npx tsx --env-file=.env scripts/seed-form-types.ts
 */
import { seedFormTypes, PURCHASE_AGREEMENT_KEY } from "../lib/form-types-seed";
import { seedForm300 } from "../lib/form-300-seed";
import { prisma } from "../lib/db";

async function main() {
  const types = await seedFormTypes();
  const f3 = await seedForm300();

  console.log("✅ Document types seeded");
  for (const t of types) {
    const row = await prisma.form_types.findUniqueOrThrow({ where: { key: t.key } });
    const fields = (row.field_set as Array<{ tier: string; core_key: string | null }>) ?? [];
    const core = fields.filter((f) => f.tier === "core").length;
    const withKey = fields.filter((f) => f.core_key).length;
    console.log(`  ${row.key}: ${fields.length} fields (${core} core, ${fields.length - core} common, ${withKey} auto-fill)`);
  }

  const form300 = await prisma.known_forms.findUniqueOrThrow({ where: { id: f3.id } });
  const type = await prisma.form_types.findUnique({ where: { key: PURCHASE_AGREEMENT_KEY } });
  const linked = form300.type_id && type && form300.type_id === type.id;
  console.log(`\n  FORM 300 (${f3.field_count} fields) → type_id ${form300.type_id ?? "null"} ${linked ? "✅ linked to purchase_agreement" : "⚠️ NOT linked"}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
