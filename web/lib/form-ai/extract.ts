/**
 * Deterministic field extraction (NO AI). Reads a fillable PDF's AcroForm fields
 * with pdf-lib — name, type, page, and widget rectangle — so the AI only has to
 * do the semantic mapping (name -> core key), not pixel detection.
 *
 * v2 scope: AcroForm (fillable) PDFs. A flat / scanned PDF has no form fields and
 * returns [] — the caller treats that as "this form isn't fillable yet". Vision /
 * OCR detection is a future implementation behind this same function's shape.
 */
import {
  PDFDocument,
  PDFName,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
  PDFSignature,
  type PDFField,
} from "pdf-lib";
import type { DetectedField, DetectedFieldType } from "./types";

function classify(field: PDFField): DetectedFieldType {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "checkbox";
  if (field instanceof PDFDropdown) return "text";
  if (field instanceof PDFOptionList) return "text";
  if (field instanceof PDFSignature) return "signature";
  return "unknown";
}

const ZERO_RECT = { x: 0, y: 0, width: 0, height: 0 };

/**
 * Extract every fillable field from a PDF's AcroForm. Returns [] for a PDF with
 * no form fields (flat/scanned). One DetectedField per widget so positions are
 * captured; fields with >1 widget get "name#1", "name#2", … .
 */
export async function extractAcroFields(
  bytes: Uint8Array
): Promise<DetectedField[]> {
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });

  const form = doc.getForm();
  const fields = form.getFields();
  if (fields.length === 0) return [];

  // Page lookup: a widget's /P entry is an indirect ref to its page; match it to
  // a page by ref string ("12 0 R"). Falls back to page 1 when absent.
  const pageTags = doc.getPages().map((p) => p.ref.toString());
  const out: DetectedField[] = [];

  for (const field of fields) {
    const name = safeName(field);
    const type = classify(field);

    let widgets: ReturnType<PDFField["acroField"]["getWidgets"]> = [];
    try {
      widgets = field.acroField.getWidgets();
    } catch {
      widgets = [];
    }

    if (widgets.length === 0) {
      out.push({ name, type, page: 1, rect: { ...ZERO_RECT } });
      continue;
    }

    widgets.forEach((widget, i) => {
      let rect = { ...ZERO_RECT };
      try {
        const r = widget.getRectangle();
        rect = { x: r.x, y: r.y, width: r.width, height: r.height };
      } catch {
        // leave zero rect — geometry is refined at template creation (step 5)
      }

      let page = 1;
      try {
        const pageRef = widget.dict.get(PDFName.of("P"));
        const tag = pageRef ? pageRef.toString() : "";
        const idx = tag ? pageTags.indexOf(tag) : -1;
        if (idx >= 0) page = idx + 1;
      } catch {
        // leave page 1
      }

      out.push({
        name: widgets.length > 1 ? `${name}#${i + 1}` : name,
        type,
        page,
        rect,
      });
    });
  }

  return out;
}

function safeName(field: PDFField): string {
  try {
    return field.getName();
  } catch {
    return "";
  }
}
