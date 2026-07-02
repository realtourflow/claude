import { prisma } from "./db";
import { extractAcroFields } from "./form-ai/extract";
import { PDFDocument } from "pdf-lib";
import {
  matchKnownForm,
  matchFlatKnownForm,
  matchTextLayoutKnownForm,
  TEXT_LAYOUT_MATCH_THRESHOLD,
  copyKnownFields,
  type KnownFormRow,
} from "./known-forms";
import { extractPdfText } from "./pdf-text";
import { computeTextFingerprint } from "./text-layout";
import { enqueueFormDetectJob } from "./queue";
import {
  getAttestationStatement,
  runFieldPipeline,
  sha256Hex,
  type FormSide,
} from "./uploaded-forms";

// The declared type is required for a flat form we can't recognize (guided vision
// needs the type's field set). The caller maps this to a 422.
export class FormTypeRequiredError extends Error {}
// The background vision job couldn't be enqueued; the caller maps this to a 503.
export class FormDetectEnqueueError extends Error {}

export type CreatedForm = {
  id: string;
  label: string;
  side: string;
  status: string;
  source_file_name: string;
  created_at: Date;
  fieldCount: number;
  needsReviewCount: number;
};

/**
 * Turn one blank-form PDF into an uploaded_forms row: recognition-first (the
 * known-forms catalog), else exact AcroForm placement, else guided vision. The
 * form lands in `pending_review` (or `detecting` while vision runs); it is never
 * auto-approved.
 *
 * Shared by the agent upload route (`/me/forms`) and the admin bundle split (each
 * carved child PDF is processed exactly like a fresh upload — because each child
 * is its own PDF, its fields are extracted from the child's own page 1..N, so no
 * coordinate re-basing is ever needed).
 *
 * The caller owns the size/namespace/attestation guards and S3 cleanup on error.
 */
export async function createUploadedForm(input: {
  agentId: string;
  s3Key: string;
  bytes: Uint8Array;
  label: string;
  side: FormSide;
  formTypeId: string | null;
  market: string;
  fileName: string;
  mimeType: string;
  attestationStatement?: string;
}): Promise<CreatedForm> {
  const {
    agentId,
    s3Key,
    bytes,
    label,
    side,
    formTypeId,
    market,
    fileName,
    mimeType,
  } = input;
  const statement = input.attestationStatement ?? (await getAttestationStatement());

  const fields = await extractAcroFields(bytes);

  // Recognition (Layer 1): consult the known-forms catalog FIRST. FILLABLE PDFs
  // match by AcroForm structure. FLAT PDFs match by exact content hash then by
  // text-layout similarity. Best-effort — errors fall through to the AI pipeline.
  let fingerprint = "";
  let known: KnownFormRow | null = null;
  try {
    if (fields.length === 0) {
      const r = await matchFlatKnownForm({ bytes, market });
      fingerprint = r.fingerprint;
      known = r.known;
      if (!known) {
        const tf = computeTextFingerprint(await extractPdfText(bytes));
        const t = await matchTextLayoutKnownForm({
          fingerprint: tf,
          market,
          threshold: TEXT_LAYOUT_MATCH_THRESHOLD,
        });
        known = t.best;
      }
    } else {
      const pageCount = (
        await PDFDocument.load(bytes, { ignoreEncryption: true })
      ).getPageCount();
      const r = await matchKnownForm({ fields, pageCount, market });
      fingerprint = r.fingerprint;
      known = r.known;
    }
  } catch (err) {
    console.error("form recognition failed; using AI pipeline", err);
  }

  // FLAT + unrecognized → guided vision. Needs the declared type to know which
  // field set to locate. Create in 'detecting' and run vision in the background.
  if (fields.length === 0 && !known) {
    if (!formTypeId) throw new FormTypeRequiredError();
    const visionForm = await prisma.uploaded_forms.create({
      data: {
        agent_id: agentId,
        label,
        side,
        board: market,
        source_s3_key: s3Key,
        source_file_name: fileName,
        mime_type: mimeType,
        file_size: bytes.length,
        file_sha256: sha256Hex(bytes),
        structure_sha256: fingerprint,
        form_type_id: formTypeId,
        detection_source: "vision",
        status: "detecting",
        attested_by: agentId,
        attestation_statement: statement,
      },
      select: {
        id: true,
        label: true,
        side: true,
        status: true,
        source_file_name: true,
        created_at: true,
      },
    });
    try {
      await enqueueFormDetectJob(visionForm.id);
    } catch (err) {
      await prisma.uploaded_forms.delete({ where: { id: visionForm.id } });
      throw new FormDetectEnqueueError(err instanceof Error ? err.message : String(err));
    }
    return { ...visionForm, fieldCount: 0, needsReviewCount: 0 };
  }

  // Recognized (catalog) or fillable (exact AcroForm rects) — no vision, so no
  // placement gate (detection_source defaults handle that).
  const form = await prisma.uploaded_forms.create({
    data: {
      agent_id: agentId,
      label,
      side,
      board: known?.board ?? market,
      source_s3_key: s3Key,
      source_file_name: fileName,
      mime_type: mimeType,
      file_size: bytes.length,
      file_sha256: sha256Hex(bytes),
      structure_sha256: fingerprint,
      recognized_from_known_form_id: known?.id ?? null,
      form_type_id: formTypeId,
      detection_source: known ? "recognized" : "acroform",
      attested_by: agentId,
      attestation_statement: statement,
      ...(known?.role_mapping ? { role_mapping: known.role_mapping as object } : {}),
    },
    select: {
      id: true,
      label: true,
      side: true,
      status: true,
      source_file_name: true,
      created_at: true,
    },
  });

  // Recognized → copy the verified field map (no AI). Else the AI pipeline. A copy
  // failure falls back to the pipeline so the create never throws.
  let counts: { fieldCount: number; needsReviewCount: number };
  if (known) {
    try {
      counts = await copyKnownFields(form.id, known);
    } catch (err) {
      console.error("copyKnownFields failed; using AI pipeline", err);
      counts = await runFieldPipeline({ formId: form.id, side, fields });
    }
  } else {
    counts = await runFieldPipeline({ formId: form.id, side, fields });
  }

  return {
    ...form,
    fieldCount: counts.fieldCount,
    needsReviewCount: counts.needsReviewCount,
  };
}
