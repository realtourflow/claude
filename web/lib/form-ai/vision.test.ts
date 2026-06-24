import { describe, it, expect } from "vitest";
import {
  ClaudeVisionDetector,
  getVisionDetector,
  setVisionDetectorForTesting,
  VisionNotConfiguredError,
  type RenderedPage,
  type MessagesCreate,
} from "@/lib/form-ai/vision";

// A fake renderer: hands the detector pre-baked page geometry (no poppler).
function renderer(pages: RenderedPage[]) {
  return async () => pages;
}
// A fake model: returns the given per-page tool outputs in order.
function model(perPageFields: Array<Array<Record<string, unknown>>>): MessagesCreate {
  let call = 0;
  return async () => ({
    stop_reason: "tool_use",
    content: [{ type: "tool_use", input: { fields: perPageFields[call++] ?? [] } }],
  });
}

const PAGE = (n: number): RenderedPage => ({
  pageNumber: n,
  pngBase64: "x",
  widthPts: 612,
  heightPts: 792,
});

describe("ClaudeVisionDetector", () => {
  it("converts a page-fraction box (top-left) to a PDF-point rect (bottom-left)", async () => {
    const det = new ClaudeVisionDetector(
      renderer([PAGE(1)]),
      model([[{ type: "text", label: "Buyer Name", x: 0.1, y: 0.2, width: 0.3, height: 0.05 }]])
    );
    const [f] = await det.detect({ pdfBytes: new Uint8Array() });
    expect(f.type).toBe("text");
    expect(f.page).toBe(1);
    expect(f.nearbyText).toBe("Buyer Name");
    expect(f.name).toBe("buyer_name"); // label slug — the mapper's signal
    expect(f.rect.x).toBeCloseTo(61.2, 1); // 0.1 * 612
    expect(f.rect.width).toBeCloseTo(183.6, 1); // 0.3 * 612
    expect(f.rect.height).toBeCloseTo(39.6, 1); // 0.05 * 792
    // y(bottom-left) = 792 - 0.2*792 - 39.6 = 594
    expect(f.rect.y).toBeCloseTo(594, 1);
  });

  it("keeps point-anchored checkboxes/signatures but drops degenerate text boxes", async () => {
    const det = new ClaudeVisionDetector(
      renderer([PAGE(1)]),
      model([
        [
          { type: "checkbox", label: "Agree", x: 0.5, y: 0.5, width: 0, height: 0 },
          { type: "signature", label: "Sign", x: 0.2, y: 0.8, width: 0, height: 0 },
          { type: "text", label: "Empty", x: 0.1, y: 0.1, width: 0, height: 0 },
        ],
      ])
    );
    const out = await det.detect({ pdfBytes: new Uint8Array() });
    const labels = out.map((f) => f.nearbyText);
    expect(labels).toContain("Agree");
    expect(labels).toContain("Sign");
    expect(labels).not.toContain("Empty"); // degenerate text box dropped
  });

  it("preserves page numbers across a multi-page detect", async () => {
    const det = new ClaudeVisionDetector(
      renderer([PAGE(1), PAGE(2)]),
      model([
        [{ type: "text", label: "P1", x: 0.1, y: 0.1, width: 0.2, height: 0.03 }],
        [{ type: "date", label: "P2", x: 0.1, y: 0.1, width: 0.2, height: 0.03 }],
      ])
    );
    const out = await det.detect({ pdfBytes: new Uint8Array() });
    expect(out.find((f) => f.nearbyText === "P1")?.page).toBe(1);
    expect(out.find((f) => f.nearbyText === "P2")?.page).toBe(2);
  });

  it("coerces an unknown type and ignores malformed entries", async () => {
    const det = new ClaudeVisionDetector(
      renderer([PAGE(1)]),
      model([
        [
          { type: "wat", label: "Mystery", x: 0.1, y: 0.1, width: 0.2, height: 0.03 },
          null as unknown as Record<string, unknown>,
        ],
      ])
    );
    const out = await det.detect({ pdfBytes: new Uint8Array() });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("unknown");
  });

  it("default detector is NOT wired (throws) and honors the test seam", async () => {
    await expect(getVisionDetector().detect({ pdfBytes: new Uint8Array() })).rejects.toBeInstanceOf(
      VisionNotConfiguredError
    );
    setVisionDetectorForTesting({ detect: async () => [] });
    await expect(getVisionDetector().detect({ pdfBytes: new Uint8Array() })).resolves.toEqual([]);
    setVisionDetectorForTesting(undefined);
  });
});
