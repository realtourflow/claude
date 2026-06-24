/**
 * Serverless-safe PDF → page-PNG renderer for the guided-vision path (the upload
 * runs on Vercel, which has no poppler). pdfjs-dist rasterizes each page onto an
 * @napi-rs/canvas surface — both run in a plain Node serverless runtime.
 *
 * Renders at the SAME 150 DPI the Phase 0 eval used (poppler `-r 150`), so the
 * placement accuracy measured there (core-recall 73–89%) carries to production.
 * scripts/cmp-render.ts proves this renderer's vision output matches poppler's.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas, Path2D, DOMMatrix, ImageData } from "@napi-rs/canvas";
import type { PageRenderer, RenderedPage } from "./vision";

// pdfjs renders glyphs/clips through the global Path2D/DOMMatrix/ImageData. They
// must be @napi-rs/canvas's so its 2d context accepts the paths pdfjs builds —
// Node's own (or a missing) global makes pdfjs throw "Value is none of these types
// String, Path" mid-render. Server-only module, so overriding the globals is safe.
const g = globalThis as unknown as Record<string, unknown>;
g.Path2D = Path2D;
g.DOMMatrix = DOMMatrix;
g.ImageData = ImageData;

const DPI = 150;
const SCALE = DPI / 72; // pdfjs viewport scale=1 is 72 DPI (1 unit = 1 PDF point)
// A real contract form is well under this; bound a malicious many-page PDF.
const MAX_PAGES = 50;

// pdfjs needs a canvas factory to create surfaces in Node (its default DOM factory
// needs a browser `document`). Back it with @napi-rs/canvas.
class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(cc: { canvas: { width: number; height: number } }, width: number, height: number) {
    cc.canvas.width = Math.ceil(width);
    cc.canvas.height = Math.ceil(height);
  }
  destroy(cc: { canvas: { width: number; height: number } }) {
    cc.canvas.width = 0;
    cc.canvas.height = 0;
  }
}

/**
 * Render ONE page to a PNG buffer — the background for the admin placement overlay.
 * Same rasterizer/DPI as the vision render, so the boxes line up with what vision saw.
 */
export async function renderPagePng(pdfBytes: Uint8Array, pageNum: number): Promise<Buffer> {
  const canvasFactory = new NodeCanvasFactory();
  const doc = await getDocument({
    data: new Uint8Array(pdfBytes),
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0,
    canvasFactory,
  } as Parameters<typeof getDocument>[0]).promise;
  try {
    const page = await doc.getPage(Math.max(1, Math.min(pageNum, doc.numPages)));
    const viewport = page.getViewport({ scale: SCALE });
    const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);
    await page.render({
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    page.cleanup();
    return canvas.toBuffer("image/png");
  } finally {
    await doc.destroy();
  }
}

/** Render every page (capped) to a PNG, in the RenderedPage shape vision expects. */
export const napiRender: PageRenderer = async (pdfBytes) => {
  const canvasFactory = new NodeCanvasFactory();
  const doc = await getDocument({
    // Copy: pdfjs detaches the input buffer (would corrupt a caller reusing bytes).
    data: new Uint8Array(pdfBytes),
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0,
    // pdfjs's types omit canvasFactory from getDocument options, but it's a valid
    // runtime option (its default DOM factory needs a browser `document`).
    canvasFactory,
  } as Parameters<typeof getDocument>[0]).promise;
  try {
    const out: RenderedPage[] = [];
    const pages = Math.min(doc.numPages, MAX_PAGES);
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: SCALE });
      const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);
      await page.render({
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      // widthPts/heightPts are the PDF page size in points (scale=1), independent
      // of render DPI — vision maps box fractions back to these.
      const base = page.getViewport({ scale: 1 });
      out.push({
        pageNumber: i,
        pngBase64: canvas.toBuffer("image/png").toString("base64"),
        widthPts: base.width,
        heightPts: base.height,
      });
      page.cleanup();
    }
    return out;
  } finally {
    await doc.destroy();
  }
};
