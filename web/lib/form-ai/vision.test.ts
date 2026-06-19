import { describe, it, expect, afterEach } from "vitest";
import {
  getVisionDetector,
  setVisionDetectorForTesting,
  VisionNotConfiguredError,
  type VisionFieldDetector,
} from "@/lib/form-ai/vision";
import type { DetectedField } from "@/lib/form-ai/types";

afterEach(() => setVisionDetectorForTesting(undefined));

describe("vision detector seam", () => {
  it("the default detector is unwired (POC) and throws", async () => {
    await expect(
      getVisionDetector().detect({ pdfBytes: new Uint8Array() })
    ).rejects.toBeInstanceOf(VisionNotConfiguredError);
  });

  it("a fake detector returns DetectedField[] — the same shape extract.ts feeds the pipeline", async () => {
    // Exactly the type extractAcroFields returns, so it slots into the same
    // map → review → buildTemplateSigners path with no parallel placement system.
    const fake: VisionFieldDetector = {
      detect: async (): Promise<DetectedField[]> => [
        {
          name: "Buyer/Seller Name (Print)",
          type: "text",
          page: 1,
          rect: { x: 280, y: 600, width: 300, height: 18 },
          nearbyText: "Buyer/Seller Name (Print)",
        },
        {
          name: "Buyer/Seller Signature",
          type: "signature",
          page: 1,
          rect: { x: 280, y: 560, width: 300, height: 22 },
        },
      ],
    };
    setVisionDetectorForTesting(fake);

    const fields = await getVisionDetector().detect({ pdfBytes: new Uint8Array() });
    expect(fields).toHaveLength(2);
    expect(fields[0]).toMatchObject({ type: "text", page: 1 });
    expect(fields[0].rect).toMatchObject({ x: 280, width: 300, height: 18 });
    expect(fields[1].type).toBe("signature");
  });
});
