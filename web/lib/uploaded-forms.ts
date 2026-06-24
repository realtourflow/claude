/**
 * Agent form-upload pipeline helpers: the licensing attestation source, the
 * detect→map step that writes uploaded_form_fields rows, and shared constants.
 * Kept out of the route handlers so the pipeline is unit-testable.
 */
import { createHash } from "node:crypto";
import { prisma } from "./db";
import { getFieldMapper } from "./form-ai/mapper";
import { CORE_KEYS } from "./form-ai/core-keys";
import type { CoreKeyProposal, DetectedField } from "./form-ai/types";

// The default licensing attestation. The live wording is admin-editable in
// system_config (config.form_attestation_statement); each upload snapshots
// whatever is current into uploaded_forms.attestation_statement.
export const DEFAULT_ATTESTATION_STATEMENT =
  "I attest that I am licensed and permitted to use and host this form.";

// Below this confidence — or when the AI declined to map — a field is flagged
// for the human review gate.
export const NEEDS_REVIEW_THRESHOLD = 0.7;

export const FORM_SIDES = ["buy", "sell", "both"] as const;
export type FormSide = (typeof FORM_SIDES)[number];

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The current agent-facing licensing attestation statement, read from
 * system_config and falling back to the default when unset.
 */
export async function getAttestationStatement(): Promise<string> {
  const row = await prisma.system_config.findUnique({
    where: { id: 1 },
    select: { config: true },
  });
  const cfg = (row?.config ?? {}) as Record<string, unknown>;
  const v = cfg.form_attestation_statement;
  return typeof v === "string" && v.trim() !== ""
    ? v
    : DEFAULT_ATTESTATION_STATEMENT;
}

function needsReview(p: CoreKeyProposal): boolean {
  return p.coreKey === null || p.confidence < NEEDS_REVIEW_THRESHOLD;
}

/**
 * Runs the detect→map pipeline for one uploaded form, writing a
 * uploaded_form_fields row per detected field (deterministic extraction +
 * AI proposal + needs_review flag). An AI failure is non-fatal — fields are
 * still written with no proposal and flagged for human review.
 */
export async function runFieldPipeline(input: {
  formId: string;
  side: FormSide;
  fields: DetectedField[];
}): Promise<{ fieldCount: number; needsReviewCount: number }> {
  const { formId, side, fields } = input;
  if (fields.length === 0) return { fieldCount: 0, needsReviewCount: 0 };

  let proposals: CoreKeyProposal[] = [];
  try {
    proposals = await getFieldMapper().proposeMappings({
      fields,
      side,
      coreKeys: CORE_KEYS,
    });
  } catch {
    proposals = []; // AI down → everything falls to human review
  }

  const rows = fields.map((f, i) => {
    const p =
      proposals[i] ?? { coreKey: null, role: null, confidence: 0, rationale: "" };
    return {
      form_id: formId,
      detected_name: f.name,
      detected_type: f.type,
      page_number: f.page,
      pos_x: f.rect.x,
      pos_y: f.rect.y,
      width: f.rect.width,
      height: f.rect.height,
      nearby_text: f.nearbyText ?? "",
      ai_core_key: p.coreKey,
      ai_role: p.role,
      ai_confidence: p.confidence,
      ai_rationale: p.rationale,
      needs_review: needsReview(p),
    };
  });

  await prisma.uploaded_form_fields.createMany({ data: rows });
  return {
    fieldCount: rows.length,
    needsReviewCount: rows.filter((r) => r.needs_review).length,
  };
}
