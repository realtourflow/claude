// Extract the FORM 300 blank's text (poppler) + compute its MinHash, and write
// it into lib/form-ai/form-300-known.json (textMinhash). Run from web/:
//   npx tsx scripts/fingerprint-text-form300.ts "<path to blank.pdf>"
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { computeTextFingerprint, textShingles } from "../lib/text-layout";

const path = process.argv[2];
const text = execFileSync("pdftotext", ["-q", path, "-"]).toString();
const sig = computeTextFingerprint(text);
console.log(`extracted ${text.length} chars, ${textShingles(text).length} unique 5-word shingles`);
console.log(`minhash[0..6]: ${sig.slice(0, 6).join(",")}…`);
const jsonPath = join(import.meta.dirname, "../lib/form-ai/form-300-known.json");
const data = JSON.parse(readFileSync(jsonPath, "utf8"));
data.textMinhash = sig;
writeFileSync(jsonPath, JSON.stringify(data, null, 2));
console.log(`wrote textMinhash (${sig.length} ints) to ${jsonPath}`);
