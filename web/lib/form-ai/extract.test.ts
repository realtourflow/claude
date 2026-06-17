import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { extractAcroFields } from "@/lib/form-ai/extract";

// Build a fillable PDF in-memory so the extractor test needs no binary fixture.
async function makeFillablePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  const tf = form.createTextField("buyer_name");
  tf.addToPage(page, { x: 72, y: 700, width: 200, height: 18 });
  const cb = form.createCheckBox("agree_terms");
  cb.addToPage(page, { x: 72, y: 660, width: 12, height: 12 });
  return doc.save();
}

describe("extractAcroFields", () => {
  it("extracts AcroForm fields with name, type, page and rect", async () => {
    const bytes = await makeFillablePdf();
    const fields = await extractAcroFields(bytes);

    expect(fields).toHaveLength(2);
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));

    expect(byName.buyer_name.type).toBe("text");
    expect(byName.buyer_name.page).toBe(1);
    // Geometry is captured (pdf-lib insets the rect by the ~0.5 border width).
    expect(byName.buyer_name.rect.x).toBeGreaterThanOrEqual(70);
    expect(byName.buyer_name.rect.x).toBeLessThanOrEqual(74);
    expect(byName.buyer_name.rect.width).toBeGreaterThan(190);

    expect(byName.agree_terms.type).toBe("checkbox");
    expect(byName.agree_terms.page).toBe(1);
  });

  it("returns [] for a flat PDF with no form fields", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    expect(await extractAcroFields(bytes)).toEqual([]);
  });
});
