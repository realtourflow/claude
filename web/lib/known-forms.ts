/**
 * Recognition library (Layer 1) catalog operations: match an uploaded form's
 * structure against known forms, copy a matched form's verified field map into
 * the agent's upload (skipping the AI mapper), and snapshot an approved form
 * into the catalog ("save as known"). Recognition is a pure ACCELERATOR — a
 * matched form still lands in pending_review and passes the admin gate.
 */
import { prisma } from "./db";
import type { DetectedField } from "./form-ai/types";
import {
  computeStructureFingerprint,
  GENERIC_RATIO_THRESHOLD,
} from "./form-ai/fingerprint";

// One field in a known form's verified "answer key".
export type KnownField = {
  detected_name: string;
  // Raw extractor type (audit; equals what re-detection yields since the
  // fingerprint matched on type). detected_type is what the row's detected_type
  // column gets; effective_type is the admin's approved type and drives the
  // resolved field's final_type → DocuSign tab bucket.
  detected_type: string;
  effective_type: string;
  page_number: number;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  core_key: string | null;
  role: string | null;
  needs_review: boolean;
};

export type KnownFormRow = {
  id: string;
  label: string;
  side: string;
  board: string;
  purpose: string;
  field_count: number;
  fields: unknown;
  role_mapping: unknown;
};

const KNOWN_SELECT = {
  id: true,
  label: true,
  side: true,
  board: true,
  purpose: true,
  field_count: true,
  fields: true,
  role_mapping: true,
} as const;

/**
 * Match an uploaded form's structure against the catalog. Conservative:
 * generic-named forms are refused (no signal), and a match requires EXACTLY ONE
 * active catalog entry with the same fingerprint visible in the agent's market
 * (board '' or the agent's board). Any ambiguity → no match. The computed
 * fingerprint is always returned (for the audit column) even on no match.
 */
export async function matchKnownForm(input: {
  fields: DetectedField[];
  pageCount: number;
  market: string;
}): Promise<{ fingerprint: string; known: KnownFormRow | null }> {
  const { fingerprint, genericRatio } = computeStructureFingerprint(
    input.fields,
    input.pageCount
  );
  if (genericRatio >= GENERIC_RATIO_THRESHOLD) return { fingerprint, known: null };

  const matches = await prisma.known_forms.findMany({
    where: {
      active: true,
      fingerprint,
      board: { in: ["", input.market] },
    },
    select: KNOWN_SELECT,
  });
  return { fingerprint, known: matches.length === 1 ? matches[0] : null };
}

/**
 * Copy a matched known form's verified fields into the agent's upload. Confident
 * (mapped) fields are pre-accepted; everything else stays needs_review so the
 * admin gate still blocks approval until a human resolves it. Mirrors the row
 * shape runFieldPipeline writes, so the rest of the pipeline is unchanged.
 */
export async function copyKnownFields(
  formId: string,
  known: KnownFormRow
): Promise<{ fieldCount: number; needsReviewCount: number }> {
  const fields = (Array.isArray(known.fields) ? known.fields : []) as KnownField[];
  const rows = fields.map((f) => {
    const resolved = !f.needs_review && !!f.core_key;
    return {
      form_id: formId,
      detected_name: f.detected_name,
      detected_type: f.detected_type,
      page_number: f.page_number,
      pos_x: f.pos_x,
      pos_y: f.pos_y,
      width: f.width,
      height: f.height,
      nearby_text: "",
      ai_core_key: f.core_key,
      ai_role: f.role,
      ai_confidence: resolved ? 1 : 0,
      ai_rationale: `recognized: ${known.label}`,
      needs_review: f.needs_review,
      final_core_key: resolved ? f.core_key : null,
      final_role: resolved ? f.role : null,
      // Replay the admin's approved type (not the raw detected type) so a
      // recognized re-upload templates to the same DocuSign tab bucket the
      // admin signed off on. Fall back to detected_type for legacy rows.
      final_type: resolved ? f.effective_type ?? f.detected_type : null,
      decision: resolved ? "accepted" : "pending",
    };
  });
  await prisma.uploaded_form_fields.createMany({ data: rows });
  return {
    fieldCount: rows.length,
    needsReviewCount: rows.filter((r) => r.needs_review).length,
  };
}

export class KnownFormConflictError extends Error {}

/**
 * Insert a catalog entry (shared by the save-as-known admin action). Throws
 * KnownFormConflictError if this (fingerprint, board) is already cataloged.
 */
export async function saveKnownForm(input: {
  label: string;
  side: string;
  board: string;
  purpose: string;
  fingerprint: string;
  fieldCount: number;
  pageCount: number;
  fields: KnownField[];
  roleMapping: Record<string, string>;
  sourceFormId?: string | null;
  createdBy?: string | null;
}): Promise<{ id: string }> {
  const existing = await prisma.known_forms.findFirst({
    where: { fingerprint: input.fingerprint, board: input.board },
    select: { id: true },
  });
  if (existing) {
    throw new KnownFormConflictError(
      "a known form with this structure already exists for this market"
    );
  }
  return prisma.known_forms.create({
    data: {
      label: input.label,
      side: input.side,
      board: input.board,
      purpose: input.purpose,
      fingerprint: input.fingerprint,
      field_count: input.fieldCount,
      page_count: input.pageCount,
      fields: input.fields as object,
      role_mapping: input.roleMapping as object,
      source_form_id: input.sourceFormId ?? null,
      created_by: input.createdBy ?? null,
    },
    select: { id: true },
  });
}
