import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extractPdfText } from "../lib/pdf-text";
import { computeTextFingerprint, jaccard, textShingles } from "../lib/text-layout";
async function main() {
  const path = process.argv[2];
  const bytes = new Uint8Array(readFileSync(path));
  const pdfjsText = await extractPdfText(bytes);
  const popplerText = execFileSync("pdftotext", ["-q", path, "-"]).toString();
  const a = computeTextFingerprint(pdfjsText);
  const b = computeTextFingerprint(popplerText);
  console.log(`pdfjs chars: ${pdfjsText.length}  shingles: ${textShingles(pdfjsText).length}`);
  console.log(`poppler chars: ${popplerText.length}  shingles: ${textShingles(popplerText).length}`);
  console.log(`fingerprint jaccard (pdfjs vs poppler): ${jaccard(a, b).toFixed(3)}`);
}
main().catch((e) => { console.error(String(e)); process.exit(1); });
