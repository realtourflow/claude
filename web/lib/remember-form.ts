/**
 * Phase 4 — remember a reviewed form as a known LAYOUT, so the next agent who
 * uploads the same form is recognized and gets the reviewed placement instead of
 * re-running vision. Reuses the recognition fingerprints we already ship:
 *  - FLAT (vision/scanned) forms → content hash (flat:+sha256) + text-layout MinHash,
 *    exactly what recognition computes on a future upload.
 *  - FILLABLE forms → AcroForm structure fingerprint.
 *
 * SCOPE: the uploading agent's market by default (a reviewed RE/MAX form is offered
 * only within that market — and the fingerprint match means ONLY that exact form is
 * ever reused, never another brokerage's). A type flagged standard_board_form (a
 * genuinely standard/board-wide document) is saved universal (board = '').
 */
import { prisma } from "./db";
import { getObjectBytes } from "./s3";
import { PDFDocument } from "pdf-lib";
import { extractAcroFields } from "./form-ai/extract";
import { computeStructureFingerprint } from "./form-ai/fingerprint";
import { extractPdfText } from "./pdf-text";
import { computeTextFingerprint } from "./text-layout";
import { saveKnownForm, flatFingerprint, type KnownField } from "./known-forms";

const num = (v: unknown) => (v == null ? 0 : Number(v));

/**
 * Snapshot an APPROVED (ready) form into the recognition catalog. Throws
 * KnownFormConflictError if this (fingerprint, board) is already cataloged — the
 * approve hook swallows that (already remembered); the manual action surfaces it.
 */
export async function rememberApprovedForm(
  formId: string,
  createdBy: string | null
): Promise<{ id: string; fingerprint: string; fieldCount: number; board: string }> {
  const form = await prisma.uploaded_forms.findUnique({
    where: { id: formId },
    select: {
      label: true,
      side: true,
      board: true,
      purpose: true,
      status: true,
      source_s3_key: true,
      role_mapping: true,
      form_type_id: true,
    },
  });
  if (!form) throw new Error("form not found");
  if (form.status !== "ready") {
    throw new Error("only an approved (ready) form can be remembered");
  }

  const fieldRows = await prisma.uploaded_form_fields.findMany({
    where: { form_id: formId },
    orderBy: [{ page_number: "asc" }, { created_at: "asc" }],
  });

  const bytes = await getObjectBytes(form.source_s3_key);
  const detected = await extractAcroFields(bytes);
  const pageCount = (
    await PDFDocument.load(bytes, { ignoreEncryption: true })
  ).getPageCount();

  let fingerprint: string;
  let fieldCount: number;
  let textMinhash: number[] | null = null;
  if (detected.length === 0) {
    // Flat: recognize a future upload by exact bytes (content hash) or a re-saved
    // same-layout copy (text-layout MinHash).
    fingerprint = flatFingerprint(bytes);
    fieldCount = fieldRows.length;
    try {
      textMinhash = computeTextFingerprint(await extractPdfText(bytes));
    } catch {
      textMinhash = null; // scanned/empty-text → exact-bytes match only
    }
  } else {
    const fp = computeStructureFingerprint(detected, pageCount);
    fingerprint = fp.fingerprint;
    fieldCount = fp.fieldCount;
  }

  // Scope: agent's market unless the type is a genuinely standard/board-wide form.
  let board = form.board;
  if (form.form_type_id) {
    const type = await prisma.form_types.findUnique({
      where: { id: form.form_type_id },
      select: { standard_board_form: true },
    });
    if (type?.standard_board_form) board = "";
  }

  // Snapshot the REVIEWED answer key: the human-corrected positions + the effective
  // (admin-decided) mapping/type, with each field's actual review state preserved
  // (an approved form's fields are all resolved → the next agent gets them
  // pre-accepted, no re-mapping).
  const fields: KnownField[] = fieldRows.map((f) => {
    const touched = f.decision !== "pending";
    const coreKey = touched ? f.final_core_key : f.ai_core_key;
    const role = (touched ? f.final_role : f.ai_role) ?? null;
    const effectiveType = (touched ? f.final_type : f.detected_type) ?? f.detected_type;
    return {
      detected_name: f.detected_name,
      detected_type: f.detected_type,
      effective_type: effectiveType,
      page_number: f.page_number,
      pos_x: num(f.pos_x),
      pos_y: num(f.pos_y),
      width: num(f.width),
      height: num(f.height),
      core_key: coreKey,
      role,
      needs_review: f.needs_review,
    };
  });

  const saved = await saveKnownForm({
    label: form.label,
    side: form.side,
    board,
    purpose: form.purpose,
    fingerprint,
    fieldCount,
    pageCount,
    fields,
    roleMapping: (form.role_mapping ?? {}) as Record<string, string>,
    textMinhash,
    typeId: form.form_type_id,
    sourceFormId: formId,
    createdBy,
  });
  return { id: saved.id, fingerprint, fieldCount, board };
}
