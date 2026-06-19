// Extract the FORM 300 blank's text with the PRODUCTION extractor (pdfjs — the
// same one the live route uses, so the seed + route fingerprints are consistent)
// and write its MinHash into lib/form-ai/form-300-known.json (textMinhash).
// Run from web/:  npx tsx scripts/fingerprint-text-form300.ts "<path to blank.pdf>"
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractPdfText } from "../lib/pdf-text";
import { computeTextFingerprint, textShingles } from "../lib/text-layout";

async function main() {
  const path = process.argv[2];
  const bytes = new Uint8Array(readFileSync(path));
  const text = await extractPdfText(bytes);
  const sig = computeTextFingerprint(text);
  console.log(`pdfjs extracted ${text.length} chars, ${textShingles(text).length} unique 5-word shingles`);
  console.log(`minhash[0..6]: ${sig.slice(0, 6).join(",")}…`);
  const jsonPath = join(import.meta.dirname, "../lib/form-ai/form-300-known.json");
  const data = JSON.parse(readFileSync(jsonPath, "utf8"));
  data.textMinhash = sig;
  data.textExtractor = "pdfjs"; // record which extractor produced the fingerprint
  writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  console.log(`wrote textMinhash (${sig.length} ints, extractor=pdfjs) to ${jsonPath}`);
}
main().catch((e) => { console.error(String(e)); process.exit(1); });
