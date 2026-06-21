/**
 * Renderer-consistency proof: does the PRODUCTION renderer (pdfjs + @napi-rs/canvas,
 * lib/form-ai/render) make guided vision place fields the SAME as the poppler render
 * the Phase 0 eval used? If the renders diverged, the placement accuracy Paul
 * approved (core-recall 73–89%) wouldn't hold in prod. Runs the real locate on the
 * placement-critical pages with each renderer and compares the boxes.
 *
 * Run from web/:  npx tsx --env-file=.env scripts/cmp-render.ts
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { napiRender } from "../lib/form-ai/render";
import {
  ClaudeVisionDetector,
  type RenderedPage,
  type ExpectedField,
} from "../lib/form-ai/vision";
import type { DetectedFieldType, DetectedField } from "../lib/form-ai/types";
import typeDef from "../lib/form-ai/purchase-agreement-type.json";

const TARGETS = [
  { key: "baldwin", path: "/Users/paulleara/Downloads/New Purchase Agreement - Residential Property (BR)  (3).pdf", pages: [1, 2] },
  { key: "valleymls", path: "/Users/paulleara/Downloads/Financed Sales Contract (1).pdf", pages: [1] },
];
const VALID = new Set(["text", "checkbox", "signature", "initial", "date"]);
const FIELDS = (typeDef.fields as Array<{ label: string; type: string }>).map((f) => ({
  label: f.label,
  type: (VALID.has(f.type) ? f.type : "text") as DetectedFieldType,
}));

// One page rendered by poppler (the eval renderer) at 150 DPI.
async function popplerPage(bytes: Uint8Array, pageNum: number): Promise<RenderedPage> {
  const dir = mkdtempSync(join(tmpdir(), "cmp-"));
  const pdf = join(dir, "d.pdf");
  writeFileSync(pdf, Buffer.from(bytes));
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pg = doc.getPages()[pageNum - 1];
  execFileSync("pdftoppm", ["-png", "-r", "150", "-f", String(pageNum), "-l", String(pageNum), pdf, join(dir, "p")]);
  const png = readdirSync(dir).find((f) => f.endsWith(".png"))!;
  return {
    pageNumber: pageNum,
    pngBase64: readFileSync(join(dir, png)).toString("base64"),
    widthPts: pg.getWidth(),
    heightPts: pg.getHeight(),
  };
}

// Locate the full field set on ONE pre-rendered page (real detectGuided prompt/tool).
async function locate(page: RenderedPage, bytes: Uint8Array): Promise<Map<string, DetectedField>> {
  const detector = new ClaudeVisionDetector(async () => [page], undefined, 0);
  const expected: ExpectedField[] = FIELDS.map((f) => ({ ...f, page: page.pageNumber }));
  const found = await detector.detectGuided({ pdfBytes: bytes, expected });
  return new Map(found.map((d) => [d.name, d]));
}

const topLeft = (d: DetectedField, h: number) => ({ x: d.rect.x, y: h - (d.rect.y + d.rect.height) });

// Median position delta of fields located by BOTH runs.
function pairDelta(A: Map<string, DetectedField>, B: Map<string, DetectedField>, hA: number, hB: number): number[] {
  const out: number[] = [];
  for (const lab of new Set([...A.keys(), ...B.keys()])) {
    const a = A.get(lab), b = B.get(lab);
    if (a && b) {
      const pa = topLeft(a, hA), pb = topLeft(b, hB);
      out.push(Math.hypot(pa.x - pb.x, pa.y - pb.y));
    }
  }
  return out;
}
const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const noise: number[] = []; // poppler-vs-poppler: vision's own run-to-run jitter
  const render: number[] = []; // poppler-vs-napi: render diff + the same jitter
  for (const t of TARGETS) {
    const bytes = new Uint8Array(readFileSync(t.path));
    for (const pg of t.pages) {
      const pPage = await popplerPage(bytes, pg);
      const nPage = (await napiRender(bytes)).find((x) => x.pageNumber === pg)!;
      const dimOk = Math.abs(pPage.widthPts - nPage.widthPts) < 1 && Math.abs(pPage.heightPts - nPage.heightPts) < 1;
      // Three locates: poppler twice (noise floor) + napi once (render delta).
      const [P1, P2, N] = [await locate(pPage, bytes), await locate(pPage, bytes), await locate(nPage, bytes)];
      const dNoise = pairDelta(P1, P2, pPage.heightPts, pPage.heightPts);
      const dRender = pairDelta(P1, N, pPage.heightPts, nPage.heightPts);
      noise.push(...dNoise);
      render.push(...dRender);
      console.log(`${t.key} p${pg}: dims ${dimOk ? "match" : "DIFFER"} · located poppler ${P1.size}/${P2.size}, napi ${N.size} · median Δ — same-renderer(noise) ${Math.round(med(dNoise))}pt vs poppler-vs-napi ${Math.round(med(dRender))}pt`);
    }
  }
  const mn = med(noise), mr = med(render);
  console.log(`\nOVERALL median Δ: vision NOISE floor (poppler vs poppler) ${Math.round(mn)}pt · poppler vs NAPI ${Math.round(mr)}pt`);
  // The renderer is equivalent if swapping it adds no more spread than vision's own
  // run-to-run jitter (within ~1.4× of the noise floor).
  console.log(mr <= mn * 1.4 + 4
    ? "→ CONSISTENT: the napi render differs from poppler no more than vision differs from itself. Phase 0 placement holds in prod."
    : "→ DIVERGENCE beyond vision noise: investigate before relying on the Phase 0 numbers.");
}
main().then(() => console.log("done")).catch((e) => { console.error(e); process.exit(1); });
