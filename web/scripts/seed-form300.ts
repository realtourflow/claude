/**
 * Seed (or re-seed) the FORM 300 known-form into the recognition library.
 * Idempotent. Run from web/:  npx tsx --env-file=.env scripts/seed-form300.ts
 */
import { seedForm300, FORM_300_FINGERPRINT } from "../lib/form-300-seed";
import { prisma } from "../lib/db";

async function main() {
  const r = await seedForm300();
  const row = await prisma.known_forms.findUniqueOrThrow({ where: { id: r.id } });
  const fields = (row.fields as Array<{ core_key: string | null; role: string }>) ?? [];
  const withCore = fields.filter((f) => f.core_key).length;
  const byRole = fields.reduce<Record<string, number>>((m, f) => ((m[f.role] = (m[f.role] ?? 0) + 1), m), {});
  console.log("✅ FORM 300 seeded as a known form");
  console.log(`  id:          ${row.id}`);
  console.log(`  label:       ${row.label}`);
  console.log(`  side/board:  ${row.side} / ${row.board}`);
  console.log(`  fingerprint: ${FORM_300_FINGERPRINT}`);
  console.log(`  fields:      ${fields.length}  (${withCore} auto-fill from deal core keys, ${fields.length - withCore} form-specific)`);
  console.log(`  by role:     ${JSON.stringify(byRole)}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
