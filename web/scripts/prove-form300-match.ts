// Live proof: read the REAL blank FORM 300 from disk and confirm the seeded
// known-form recognizes it by content hash. Also clears the stale stamped-copy
// entry from earlier. Run from web/:
//   npx tsx --env-file=.env scripts/prove-form300-match.ts "<path to blank.pdf>"
import { readFileSync } from "node:fs";
import { prisma } from "../lib/db";
import { flatFingerprint, matchFlatKnownForm } from "../lib/known-forms";
import { FORM_300_FINGERPRINT } from "../lib/form-300-seed";

async function main() {
  // Clean up the stale "flat:74db…" entry seeded from DocuSign's stamped copy.
  const stale = await prisma.known_forms.deleteMany({
    where: { board: "BIRMINGHAM_AAR", fingerprint: { startsWith: "flat:" }, NOT: { fingerprint: FORM_300_FINGERPRINT } },
  });
  if (stale.count) console.log(`cleaned ${stale.count} stale FORM 300 entr${stale.count === 1 ? "y" : "ies"}`);

  const bytes = new Uint8Array(readFileSync(process.argv[2]));
  const fp = flatFingerprint(bytes);
  console.log(`real blank fingerprint: ${fp}`);
  console.log(`seed fingerprint:       ${FORM_300_FINGERPRINT}`);
  console.log(`hashes match:           ${fp === FORM_300_FINGERPRINT ? "YES ✓" : "NO ✗"}`);

  const { known } = await matchFlatKnownForm({ bytes, market: "BIRMINGHAM_AAR" });
  if (known) {
    const fields = (known.fields as unknown[]) ?? [];
    console.log(`\n✅ RECOGNIZED: "${known.label}"  (${fields.length} fields, board ${known.board})`);
  } else {
    console.log(`\n❌ NOT recognized.`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
