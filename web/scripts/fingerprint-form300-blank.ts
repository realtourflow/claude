// Inspect the REAL blank FORM 300 (the file agents upload) and derive the
// correct recognition fingerprint. Run from web/:
//   npx tsx scripts/fingerprint-form300-blank.ts "<path to blank.pdf>"
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { extractAcroFields } from "../lib/form-ai/extract";
import { computeStructureFingerprint, GENERIC_RATIO_THRESHOLD } from "../lib/form-ai/fingerprint";

async function main() {
  const path = process.argv[2];
  const bytes = new Uint8Array(readFileSync(path));
  const pageCount = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
  const fields = await extractAcroFields(bytes);
  const fileSha = createHash("sha256").update(Buffer.from(bytes)).digest("hex");

  console.log(`file: ${path.split("/").pop()}`);
  console.log(`pages: ${pageCount}`);
  console.log(`AcroForm fields: ${fields.length}`);
  if (fields.length) {
    const sample = fields.slice(0, 12).map((f) => `${f.name}:${f.type}`);
    console.log(`  sample: ${sample.join(", ")}${fields.length > 12 ? " …" : ""}`);
  }

  if (fields.length === 0) {
    console.log(`\n→ FLAT (no real AcroForm fields). Recognition = CONTENT HASH.`);
    console.log(`   fingerprint = flat:${fileSha}`);
  } else {
    const fp = computeStructureFingerprint(fields, pageCount);
    const generic = fp.genericRatio >= GENERIC_RATIO_THRESHOLD;
    console.log(`\n→ FILLABLE (${fields.length} fields). genericRatio=${fp.genericRatio.toFixed(2)} (threshold ${GENERIC_RATIO_THRESHOLD})`);
    if (generic) {
      console.log(`   ⚠️ names too generic for a structure fingerprint → fall back to CONTENT HASH`);
      console.log(`   fingerprint = flat:${fileSha}`);
    } else {
      console.log(`   ✅ STRUCTURE FINGERPRINT (matches ANY copy with this field structure — best):`);
      console.log(`   fingerprint = ${fp.fingerprint}`);
    }
    console.log(`   (content-hash fallback = flat:${fileSha})`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
