/**
 * AcroForm STRUCTURE fingerprint for the recognition library (Layer 1).
 *
 * Identifies a fillable form by its field structure (names + types + widget
 * counts + pages + page/field counts) — NOT its text or pixels. Deterministic
 * and order-independent, so two byte-different re-saves of the same form hash
 * equal. Pure (no DB), so it's shared by the upload route, the save-as-known
 * action, and unit tests.
 *
 * Conservative by design: a form whose field names are mostly auto-generated
 * (Text1, Check Box2, …) carries no identifying signal, so it's flagged via
 * genericRatio and the caller REFUSES to recognize it (falls through to the AI
 * pipeline). This kills the dominant false-positive class. Text-layout / visual
 * fingerprinting for flat (non-AcroForm) PDFs is deferred to the vision step.
 */
import { createHash } from "node:crypto";
import type { DetectedField } from "./types";

// At or above this share of generic field names, recognition is refused.
export const GENERIC_RATIO_THRESHOLD = 0.5;

const GENERIC_NAME =
  /^(text|check\s?box|checkbox|radio|button|field|untitled|signature|sig)\s?\d*$/i;

function logicalName(name: string): string {
  return name.replace(/#\d+$/, ""); // collapse extract.ts's multi-widget "name#1"/"name#2"
}
function normalize(name: string): string {
  return name.trim().normalize("NFC").toLowerCase();
}
function isGeneric(norm: string): boolean {
  return norm === "" || GENERIC_NAME.test(norm);
}

export type StructureFingerprint = {
  fingerprint: string;
  genericRatio: number;
  fieldCount: number; // logical fields (widgets collapsed)
};

export function computeStructureFingerprint(
  fields: DetectedField[],
  pageCount: number
): StructureFingerprint {
  // Collapse per-widget rows into logical fields.
  const byName = new Map<string, { type: string; widgets: number; pages: Set<number> }>();
  for (const f of fields) {
    const key = normalize(logicalName(f.name));
    const e = byName.get(key) ?? { type: f.type, widgets: 0, pages: new Set<number>() };
    e.widgets += 1;
    e.pages.add(f.page);
    byName.set(key, e);
  }

  const tokens = [...byName.entries()]
    .map(
      ([name, e]) =>
        `${name}${e.type}${e.widgets}${[...e.pages]
          .sort((a, b) => a - b)
          .join(",")}`
    )
    .sort();

  const fieldCount = byName.size;
  const canonical =
    `v1|pageCount=${pageCount}|fieldCount=${fieldCount}\n` + tokens.join("\n");
  const fingerprint = "v1:" + createHash("sha256").update(canonical).digest("hex");

  const genericCount = [...byName.keys()].filter(isGeneric).length;
  const genericRatio = fieldCount === 0 ? 1 : genericCount / fieldCount;

  return { fingerprint, genericRatio, fieldCount };
}
