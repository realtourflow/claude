/**
 * GUIDED vision eval for FORM 300. Renders the REAL blank (the file agents
 * upload), hands the detector the 88-field catalog as the EXPECTED set, and
 * scores how well guided mode LOCATES each known field vs the catalog's verified
 * positions. Reports recall / over-detection / position offset / type / core-key
 * — and recall after applying the ~15-20pt offset calibration (one run shows
 * both raw and calibrated). Manual; needs ANTHROPIC_API_KEY + poppler.
 *
 * Run from web/:
 *   npx tsx --env-file=.env scripts/eval-vision-guided.ts "<path to blank.pdf>"
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import {
  ClaudeVisionDetector,
  type PageRenderer,
  type RenderedPage,
  type ExpectedField,
} from "../lib/form-ai/vision";
import type { DetectedFieldType, DetectedField } from "../lib/form-ai/types";
import catalog from "../lib/form-ai/form-300-known.json";

const CORE_KEY_LABELS = new Set([
  "buyer_name",
  "purchase_price",
  "earnest_money_amount",
  "closing_date",
  "legal_description",
]);

type RawField = { label: string; type: string; page: number; pos_x: number; pos_y: number; width: number; height: number };

const popplerRender: PageRenderer = async (pdfBytes) => {
  const dir = mkdtempSync(join(tmpdir(), "guided-"));
  const pdfPath = join(dir, "doc.pdf");
  writeFileSync(pdfPath, Buffer.from(pdfBytes));
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const sizes = doc.getPages().map((p) => ({ w: p.getWidth(), h: p.getHeight() }));
  execFileSync("pdftoppm", ["-png", "-r", "300", pdfPath, join(dir, "p")]);
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

// detected rect (bottom-left) → top-left top edge, for comparison with ground truth.
function detTop(f: DetectedField, pageH: number) {
  return { x: f.rect.x, y: pageH - (f.rect.y + f.rect.height) };
}
const median = (a: number[]) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const path = process.argv[2];
  const bytes = new Uint8Array(readFileSync(path));
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pageH = doc.getPages().map((p) => p.getHeight());
  const pageW = doc.getPages().map((p) => p.getWidth());

  const fields = catalog.fields as RawField[];
  const expected: ExpectedField[] = fields.map((f) => {
    const w = pageW[f.page - 1] ?? 612;
    const h = pageH[f.page - 1] ?? 792;
    return {
      label: f.label,
      type: f.type as DetectedFieldType,
      page: f.page,
      // catalog position → page-fraction top-left hint
      hintX: f.pos_x / w,
      hintY: (h - f.pos_y - f.height) / h,
    };
  });
  // ground-truth top-left position per (label,page), from the catalog.
  const truth = fields.map((f) => ({
    label: f.label,
    type: f.type,
    page: f.page,
    x: f.pos_x,
    y: Math.round((pageH[f.page - 1] ?? 792) - f.pos_y - f.height),
    isCore: CORE_KEY_LABELS.has(f.label),
  }));

  // calibrateY=0: measure the RAW offset, then apply the calibration in scoring.
  const detector = new ClaudeVisionDetector(popplerRender, undefined, 0);
  const detected = await detector.detectGuided({ pdfBytes: bytes, expected });

  // Index detected by label+page (guided returns name=label).
  const detByKey = new Map<string, DetectedField>();
  for (const d of detected) detByKey.set(`${d.name}@${d.page}`, d);

  // First pass: raw signed offsets of matched fields (to derive the calibration).
  const dxs: number[] = [];
  const dys: number[] = [];
  for (const g of truth) {
    const d = detByKey.get(`${g.label}@${g.page}`);
    if (!d) continue;
    const t = detTop(d, pageH[g.page - 1] ?? 792);
    dxs.push(t.x - g.x);
    dys.push(t.y - g.y);
  }
  const calX = Math.round(median(dxs)) || 0;
  const calY = Math.round(median(dys)) || 0;

  // Score raw and calibrated (subtract the measured offset).
  function score(applyCal: boolean) {
    let found24 = 0, found40 = 0, typeOk = 0, coreTotal = 0, coreOk = 0;
    const dists: number[] = [];
    for (const g of truth) {
      if (g.isCore) coreTotal++;
      const d = detByKey.get(`${g.label}@${g.page}`);
      if (!d) continue;
      const t = detTop(d, pageH[g.page - 1] ?? 792);
      const dx = t.x - g.x - (applyCal ? calX : 0);
      const dy = t.y - g.y - (applyCal ? calY : 0);
      const dist = Math.hypot(dx, dy);
      if (dist <= 24) found24++;
      if (dist <= 40) {
        found40++;
        dists.push(dist);
        if (d.type === g.type) typeOk++;
        if (g.isCore) coreOk++;
      }
    }
    return { found24, found40, typeOk, coreTotal, coreOk, med: median(dists) };
  }

  const raw = score(false);
  const cal = score(true);
  const N = truth.length;
  const pct = (n: number) => `${Math.round((100 * n) / N)}%`;

  console.log(`\n=== FORM 300 — GUIDED (${N} expected · ${detected.length} located) ===`);
  console.log(`over-detection:   ${detected.length}/${N} = ${(detected.length / N).toFixed(2)}× (blind was 2.5×)`);
  console.log(`recall (raw):     @24pt ${raw.found24}/${N} (${pct(raw.found24)})   @40pt ${raw.found40}/${N} (${pct(raw.found40)})`);
  console.log(`systematic offset: dx=${calX} dy=${calY}  → applying calibration:`);
  console.log(`recall (calib):   @24pt ${cal.found24}/${N} (${pct(cal.found24)})   @40pt ${cal.found40}/${N} (${pct(cal.found40)})`);
  console.log(`type accuracy:    ${cal.typeOk}/${cal.found40} (catalog-given)`);
  console.log(`position error:   median ${Math.round(cal.med)}pt (calibrated)`);
  console.log(`core-key (the 5): ${cal.coreOk}/${cal.coreTotal} located & placed`);
}
main().then(() => console.log("\n✅ guided eval done")).catch((e) => { console.error(e); process.exit(1); });
