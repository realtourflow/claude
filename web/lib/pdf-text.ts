/**
 * PDF text extraction via pdfjs-dist — runs in a serverless Node runtime (no
 * poppler binary), so the live upload route can compute a text-layout
 * fingerprint on Vercel. Reads the visible text in page order; the text-layout
 * fingerprint (lib/text-layout) normalizes + shingles it, so exact spacing
 * doesn't matter (only the word sequence).
 */
// Legacy build runs in plain Node without a DOM/worker.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// A real contract form is well under this; cap the loop so a malicious
// many-page PDF can't run away (the text-layout signal is in the early pages).
const MAX_PAGES = 50;

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const doc = await getDocument({
    // Copy: pdfjs transfers (detaches) the input buffer to its worker, which
    // would corrupt the caller's bytes if they're reused (e.g. hashed too).
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    isEvalSupported: false,
    // Quiet pdfjs in a server context.
    verbosity: 0,
  }).promise;
  try {
    const parts: string[] = [];
    const pages = Math.min(doc.numPages, MAX_PAGES);
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(
        content.items
          .map((it) => ("str" in it ? it.str : ""))
          .join(" ")
      );
    }
    return parts.join("\n");
  } finally {
    // Always tear down (a corrupt page mid-loop must not leak the doc).
    await doc.destroy();
  }
}
