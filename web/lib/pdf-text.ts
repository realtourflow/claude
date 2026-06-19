/**
 * PDF text extraction via pdfjs-dist — runs in a serverless Node runtime (no
 * poppler binary), so the live upload route can compute a text-layout
 * fingerprint on Vercel. Reads the visible text in page order; the text-layout
 * fingerprint (lib/text-layout) normalizes + shingles it, so exact spacing
 * doesn't matter (only the word sequence).
 */
// Legacy build runs in plain Node without a DOM/worker.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

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
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    parts.push(
      content.items
        .map((it) => ("str" in it ? it.str : ""))
        .join(" ")
    );
  }
  await doc.destroy();
  return parts.join("\n");
}
