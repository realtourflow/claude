/**
 * Vision detector accuracy eval (manual — not CI; needs ANTHROPIC_API_KEY +
 * DocuSign creds + poppler `pdftoppm`).
 *
 * For each real flat form it: downloads the blank PDF from its DocuSign template,
 * runs the REAL ClaudeVisionDetector (poppler render → Claude vision → field
 * boxes), runs the REAL AI mapper on the detected labels, and scores the result
 * against that template's hand-placed tabs (the ground truth). Reports, per form:
 *   recall (fields found within tolerance) · type accuracy · median position
 *   error · core-key accuracy (on the fields that map to a registry core key).
 *
 * Run from web/:  npx tsx --env-file=.env scripts/eval-vision.ts
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPrivateKey } from "node:crypto";
import { SignJWT } from "jose";
import { PDFDocument } from "pdf-lib";
import { ClaudeVisionDetector, type PageRenderer, type RenderedPage } from "../lib/form-ai/vision";
import { getFieldMapper } from "../lib/form-ai/mapper";
import { CORE_KEYS } from "../lib/form-ai/core-keys";
import type { DetectedField } from "../lib/form-ai/types";

const FORMS = [
  { key: "wire_fraud", guid: "07a056ca-37e7-4b4c-8cbf-ddfa417abc5c", side: "both" as const },
  { key: "lead_paint", guid: "9f07a70a-705b-4cd7-8c5c-80aaf0ac487c", side: "both" as const },
  { key: "form_300", guid: "07746681-f55d-49c2-a47a-e54593fe84f0", side: "buy" as const },
];

// Hand answer key: ground-truth Data Labels that SHOULD map to a registry core
// key (the rest are form-specific and the mapper should decline → agent-entered).
const CORE_KEY_ANSWERS: Record<string, string> = {
  brokerage_name: "brokerage_name",
  buyer_name: "buyer_name",
  agent_name: "agent_name",
  purchase_price: "purchase_price",
  earnest_money_amount: "earnest_money_amount",
  closing_date: "closing_date",
  legal_description: "legal_description",
};

const MATCH_TOLERANCE_PT = 24; // a detected box counts as "found" within this of the truth

// DocuSign tab kind → our DetectedFieldType.
const TAB_TYPE: Record<string, string> = {
  textTabs: "text",
  numericalTabs: "text",
  fullNameTabs: "text",
  checkboxTabs: "checkbox",
  signHereTabs: "signature",
  initialHereTabs: "initial",
  dateSignedTabs: "date",
  dateTabs: "date",
  emailAddressTabs: "text",
};

const {
  DOCUSIGN_INTEGRATION_KEY,
  DOCUSIGN_USER_ID,
  DOCUSIGN_ACCOUNT_ID,
  DOCUSIGN_PRIVATE_KEY,
  DOCUSIGN_BASE_URL,
} = process.env as Record<string, string>;

async function dsToken(): Promise<string> {
  const base = DOCUSIGN_BASE_URL.replace(/\/+$/, "");
  const authHost = base.includes("demo") ? "https://account-d.docusign.com" : "https://account.docusign.com";
  const now = Math.floor(Date.now() / 1000);
  const key = createPrivateKey(DOCUSIGN_PRIVATE_KEY.replace(/\\n/g, "\n"));
  const assertion = await new SignJWT({ scope: "signature impersonation" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(DOCUSIGN_INTEGRATION_KEY)
    .setSubject(DOCUSIGN_USER_ID)
    .setAudience(authHost.replace(/^https?:\/\//, ""))
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const r = await fetch(`${authHost}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  return (await r.json()).access_token as string;
}
const dsBase = () => DOCUSIGN_BASE_URL.replace(/\/+$/, "");

type GroundField = { label: string; type: string; page: number; x: number; y: number };

async function groundTruth(token: string, guid: string): Promise<GroundField[]> {
  const r = await fetch(
    `${dsBase()}/restapi/v2.1/accounts/${DOCUSIGN_ACCOUNT_ID}/templates/${guid}/recipients?include_tabs=true`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  const data = (await r.json()) as { signers?: Array<{ tabs?: Record<string, Array<Record<string, unknown>>> }> };
  const out: GroundField[] = [];
  for (const s of data.signers ?? []) {
    for (const [kind, mapped] of Object.entries(TAB_TYPE)) {
      for (const t of s.tabs?.[kind] ?? []) {
        const label = String(t.tabLabel ?? t.name ?? "");
        if (/^(Text|Checkbox|Signature|Date Signed|Initial) [0-9a-f]{8}/.test(label)) continue; // stray auto-named
        out.push({ label, type: mapped, page: Number(t.pageNumber ?? 1), x: Math.round(Number(t.xPosition)), y: Math.round(Number(t.yPosition)) });
      }
    }
  }
  return out;
}

async function downloadPdf(token: string, guid: string): Promise<Uint8Array> {
  const r = await fetch(
    `${dsBase()}/restapi/v2.1/accounts/${DOCUSIGN_ACCOUNT_ID}/templates/${guid}/documents/1`,
    { headers: { authorization: `Bearer ${token}`, accept: "application/pdf" } }
  );
  return new Uint8Array(await r.arrayBuffer());
}

// poppler renderer: pdfBytes → one RenderedPage per page (PDF-point sizes from pdf-lib).
const popplerRender: PageRenderer = async (pdfBytes) => {
  const dir = mkdtempSync(join(tmpdir(), "vision-"));
  const pdfPath = join(dir, "doc.pdf");
  writeFileSync(pdfPath, Buffer.from(pdfBytes));
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const sizes = doc.getPages().map((p) => ({ w: p.getWidth(), h: p.getHeight() }));
  execFileSync("pdftoppm", ["-png", "-r", "150", pdfPath, join(dir, "p")]);
  const pngs = readdirSync(dir).filter((f) => f.endsWith(".png")).sort((a, b) => {
    const n = (s: string) => Number(s.match(/p-?(\d+)\.png$/)?.[1] ?? 0);
    return n(a) - n(b);
  });
  return pngs.map((f, i): RenderedPage => ({
    pageNumber: i + 1,
    pngBase64: readFileSync(join(dir, f)).toString("base64"),
    widthPts: sizes[i]?.w ?? 612,
    heightPts: sizes[i]?.h ?? 792,
  }));
};

// DocuSign tabs are top-left origin; our DetectedField rect is bottom-left. Compare
// in a common frame (top-left): detected top y = pageHeight - (rect.y + height).
function detTop(f: DetectedField, pageH: number) {
  return { x: f.rect.x, y: pageH - (f.rect.y + f.rect.height) };
}

async function run() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const token = await dsToken();
  const detector = new ClaudeVisionDetector(popplerRender);
  const mapper = getFieldMapper();

  for (const form of FORMS) {
    const pdfBytes = await downloadPdf(token, form.guid);
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const pageH = doc.getPages().map((p) => p.getHeight());
    const truth = await groundTruth(token, form.guid);

    const detected = await detector.detect({ pdfBytes });
    const proposals = await mapper.proposeMappings({ fields: detected, side: form.side, coreKeys: CORE_KEYS });

    // Match each truth field to its nearest detected field on the same page.
    // Separate "found it at all" (looser) from "placed precisely" (tight), and
    // surface the SIGNED offset so a systematic shift (calibratable) is visible.
    const median = (a: number[]) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);
    const dists: number[] = [];
    const dxs: number[] = [];
    const dys: number[] = [];
    let found24 = 0;
    let found40 = 0;
    let typeOk = 0;
    let coreTotal = 0;
    let coreOk = 0;
    for (const g of truth) {
      // for...of (not forEach) so TS narrows `best` correctly after the loop.
      let best: { f: DetectedField; i: number; d: number; dx: number; dy: number } | null = null;
      for (const [i, f] of detected.entries()) {
        if (f.page !== g.page) continue;
        const t = detTop(f, pageH[g.page - 1] ?? 792);
        const d = Math.hypot(t.x - g.x, t.y - g.y);
        if (!best || d < best.d) best = { f, i, d, dx: t.x - g.x, dy: t.y - g.y };
      }
      if (!best) continue;
      if (best.d <= 24) found24++;
      if (best.d <= 40) {
        found40++;
        dists.push(best.d);
        dxs.push(best.dx);
        dys.push(best.dy);
        if (best.f.type === g.type) typeOk++;
        const answer = CORE_KEY_ANSWERS[g.label];
        if (answer) {
          coreTotal++;
          if (proposals[best.i]?.coreKey === answer) coreOk++;
        }
      }
    }
    const pct = (n: number) => `${Math.round((100 * n) / truth.length)}%`;
    console.log(`\n=== ${form.key} (${truth.length} ground-truth fields · ${detected.length} detected) ===`);
    console.log(`recall @24pt:    ${found24}/${truth.length} (${pct(found24)})   @40pt: ${found40}/${truth.length} (${pct(found40)})`);
    console.log(`type accuracy:   ${typeOk}/${found40} (${found40 ? Math.round((100 * typeOk) / found40) : 0}% of found)`);
    console.log(`position error:  median ${Math.round(median(dists))}pt   systematic offset dx=${Math.round(median(dxs))} dy=${Math.round(median(dys))}`);
    console.log(`core-key:        ${coreOk}/${coreTotal} of registry-mappable fields`);
  }
}

run().then(() => console.log("\n✅ eval done")).catch((e) => { console.error("eval failed:", e); process.exit(1); });
