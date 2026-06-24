/**
 * Proof: the text-layout fingerprint matches non-exact FORM 300 copies and does
 * NOT false-match a different form. Seeds FORM 300, then for each test PDF
 * extracts text (poppler) → MinHash → matchTextLayoutKnownForm, printing the
 * confidence (Jaccard) so we can choose a threshold.
 *
 * Run from web/:  npx tsx --env-file=.env scripts/prove-text-layout.ts "<form300 blank.pdf>"
 */
import { readFileSync } from "node:fs";
import { createPrivateKey } from "node:crypto";
import { SignJWT } from "jose";
import { PDFDocument } from "pdf-lib";
import { seedForm300 } from "../lib/form-300-seed";
import { computeTextFingerprint } from "../lib/text-layout";
import { extractPdfText } from "../lib/pdf-text"; // production extractor (pdfjs)
import { matchTextLayoutKnownForm } from "../lib/known-forms";

const MARKET = "BIRMINGHAM_AAR";

async function dsDoc(guid: string): Promise<Uint8Array> {
  const e = process.env as Record<string, string>;
  const base = e.DOCUSIGN_BASE_URL.replace(/\/+$/, "");
  const authHost = base.includes("demo") ? "https://account-d.docusign.com" : "https://account.docusign.com";
  const now = Math.floor(Date.now() / 1000);
  const key = createPrivateKey(e.DOCUSIGN_PRIVATE_KEY.replace(/\\n/g, "\n"));
  const assertion = await new SignJWT({ scope: "signature impersonation" }).setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuer(e.DOCUSIGN_INTEGRATION_KEY).setSubject(e.DOCUSIGN_USER_ID).setAudience(authHost.replace(/^https?:\/\//, "")).setIssuedAt(now).setExpirationTime(now + 3600).sign(key);
  const token = (await (await fetch(`${authHost}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString() })).json()).access_token;
  return new Uint8Array(await (await fetch(`${base}/restapi/v2.1/accounts/${e.DOCUSIGN_ACCOUNT_ID}/templates/${guid}/documents/1`, { headers: { authorization: `Bearer ${token}`, accept: "application/pdf" } })).arrayBuffer());
}

async function check(name: string, text: string, expectMatch: boolean) {
  const fp = computeTextFingerprint(text);
  const { best, confidence, runnerUp } = await matchTextLayoutKnownForm({ fingerprint: fp, market: MARKET, threshold: 0 });
  void best; void runnerUp;
  const flag = expectMatch ? (confidence >= 0.5 ? "✓ matches" : "✗ MISSED") : (confidence < 0.5 ? "✓ rejected" : "✗ FALSE MATCH");
  console.log(`  ${name.padEnd(40)} confidence ${confidence.toFixed(3)}   ${flag}`);
  return confidence;
}

async function main() {
  await seedForm300();
  const blankPath = process.argv[2];
  const blank = new Uint8Array(readFileSync(blankPath));

  // FORM 300 variants (should match)
  const reSaved = await (await PDFDocument.load(blank, { ignoreEncryption: true })).save(); // different bytes, same text
  const reSaved2 = await (async () => { const d = await PDFDocument.load(blank, { ignoreEncryption: true }); d.setTitle("re-exported"); d.setProducer("Adobe"); return d.save(); })();
  const words = (await extractPdfText(blank)).split(/\s+/);
  const perturbed = words.filter((_, i) => i % 20 !== 0).join(" "); // drop ~5% of words (re-export noise)

  console.log("\n=== FORM 300 copies (should MATCH) ===");
  await check("original blank", await extractPdfText(blank), true);
  await check("re-saved (pdf-lib)", await extractPdfText(reSaved), true);
  await check("re-exported (metadata changed)", await extractPdfText(reSaved2), true);
  await check("re-export w/ ~5% text dropped", perturbed, true);

  console.log("\n=== different forms (should NOT match) ===");
  const baa = await dsDoc("863df439-b514-4774-9718-c63fa714586b");
  const lead = await dsDoc("9f07a70a-705b-4cd7-8c5c-80aaf0ac487c");
  const cBaa = await check("Buyer Agency Agreement", await extractPdfText(baa), false);
  const cLead = await check("Lead-Based Paint Disclosure", await extractPdfText(lead), false);

  console.log(`\nmargin: lowest FORM-300 copy vs highest other form = (see above). Different-form max ≈ ${Math.max(cBaa, cLead).toFixed(3)}.`);
}
main().then(() => console.log("\n✅ proof done")).catch((e) => { console.error(e); process.exit(1); });
