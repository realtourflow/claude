/**
 * Flat-PDF field detection — the "Layer 3" vision path from the v2 design note.
 *
 * KEY ARCHITECTURAL CONSTRAINT: a VisionFieldDetector returns the SAME
 * `DetectedField[]` shape that the deterministic AcroForm extractor
 * (extract.ts) produces. So vision is a third *source* of detected fields —
 * alongside AcroForm extraction and (later) the recognition library — and its
 * output flows into the EXACT SAME pipeline: the existing swappable FieldMapper
 * assigns meaning off each field's label, the rows land in uploaded_form_fields,
 * the admin reviews them, and step 5's buildTemplateSigners places the tabs.
 * There is NO parallel placement system. Flat detection only replaces the
 * position-finding that AcroForm gives for free on fillable PDFs.
 *
 * POC STATUS: this is the swappable seam + a test fake only. The production
 * Anthropic-vision implementation is NOT built and NOT wired to any route — this
 * file ships behind no caller. See docs/flat-pdf-vision-poc.md for the
 * measurement results and the recommendation that gates building it for real.
 */
import type { DetectedField } from "./types";

export interface VisionFieldDetector {
  // Detect every fillable spot on a flat PDF: type + page + position (rect, in
  // PDF points, bottom-left origin — same as extract.ts) + the label text
  // (name/nearbyText) the FieldMapper maps to a core key.
  detect(input: { pdfBytes: Uint8Array }): Promise<DetectedField[]>;
}

export class VisionNotConfiguredError extends Error {}

let stub: VisionFieldDetector | undefined;

/** Test seam — mirrors setFieldMapperForTesting. Pass undefined to reset. */
export function setVisionDetectorForTesting(d: VisionFieldDetector | undefined): void {
  stub = d;
}

export function getVisionDetector(): VisionFieldDetector {
  if (stub) return stub;
  // Production vision (Claude vision over rendered page images → field boxes) is
  // deliberately NOT wired yet — this is a measurement POC. Flat PDFs are not
  // auto-detected until the recommendation in the POC note is acted on.
  return {
    async detect() {
      throw new VisionNotConfiguredError(
        "flat-PDF vision detection is not wired (POC) — see docs/flat-pdf-vision-poc.md"
      );
    },
  };
}
