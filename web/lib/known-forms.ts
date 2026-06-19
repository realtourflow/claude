/**
 * Recognition library (Layer 1) catalog operations: match an uploaded form's
 * structure against known forms, copy a matched form's verified field map into
 * the agent's upload (skipping the AI mapper), and snapshot an approved form
 * into the catalog ("save as known"). Recognition is a pure ACCELERATOR — a
 * matched form still lands in pending_review and passes the admin gate.
 */
import { createHash } from "node:crypto";
import { prisma } from "./db";
import type { DetectedField } from "./form-ai/types";
import {
  computeStructureFingerprint,
  GENERIC_RATIO_THRESHOLD,
} from "./form-ai/fingerprint";
import { jaccard } from "./text-layout";

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

/** Content fingerprint for a FLAT (fieldless) PDF — the exact-bytes match signal. */
export function flatFingerprint(bytes: Uint8Array): string {
  return "flat:" + createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

/**
 * Recognize a FLAT upload (no AcroForm fields → no structure fingerprint) by the
 * blank's exact content hash. Same conservative match as matchKnownForm: active,
 * visible in the market, exactly one. The upload route tries this first on a flat
 * upload, then falls back to matchTextLayoutKnownForm.
 */
export async function matchFlatKnownForm(input: {
  bytes: Uint8Array;
  market: string;
}): Promise<{ fingerprint: string; known: KnownFormRow | null }> {
  const fingerprint = flatFingerprint(input.bytes);
  const matches = await prisma.known_forms.findMany({
    where: { active: true, fingerprint, board: { in: ["", input.market] } },
    select: KNOWN_SELECT,
  });
  return { fingerprint, known: matches.length === 1 ? matches[0] : null };
}

// Confidence threshold for a text-layout match. Chosen from the proof
// (scripts/prove-text-layout.ts): real FORM 300 copies scored 0.67–1.00 (re-saves
// 1.00), while different forms (BAA, Lead Paint) scored ≤0.008 — a ~0.66 gap. 0.5
// sits in the middle with huge margin both ways: it matches every realistic
// same-layout copy yet rejects different forms AND major-revision/different-layout
// versions (which should fall through to vision, not get the wrong placement).
export const TEXT_LAYOUT_MATCH_THRESHOLD = 0.5;

/**
 * Recognize a flat upload by TEXT-LAYOUT similarity (MinHash Jaccard) when the
 * exact content hash missed — so a re-saved / re-exported same-layout copy still
 * matches a known form and gets exact catalog placement. Returns the best
 * candidate, its confidence, and the runner-up's confidence (so the caller can
 * see the margin). A match requires confidence >= threshold. Wired on the flat
 * upload path after the content hash misses.
 */
export async function matchTextLayoutKnownForm(input: {
  fingerprint: number[];
  market: string;
  threshold: number;
}): Promise<{ best: KnownFormRow | null; confidence: number; runnerUp: number }> {
  // No signal (a scanned / empty-text PDF gives an all-max signature that would
  // spuriously self-match a degenerate entry) → don't match.
  if (!input.fingerprint.length || input.fingerprint.every((v) => v === 0xffffffff)) {
    return { best: null, confidence: 0, runnerUp: 0 };
  }
  const rows = await prisma.known_forms.findMany({
    where: { active: true, board: { in: ["", input.market] } },
    select: { ...KNOWN_SELECT, text_minhash: true },
  });
  let best: KnownFormRow | null = null;
  let bestConf = 0;
  let runnerUp = 0;
  for (const r of rows) {
    const sig = r.text_minhash;
    if (!Array.isArray(sig)) continue; // entries without a text fingerprint
    const conf = jaccard(input.fingerprint, sig as number[]);
    if (conf > bestConf) {
      runnerUp = bestConf;
      bestConf = conf;
      const { text_minhash: _omit, ...rest } = r;
      void _omit;
      best = rest as KnownFormRow;
    } else if (conf > runnerUp) {
      runnerUp = conf;
    }
  }
  return bestConf >= input.threshold
    ? { best, confidence: bestConf, runnerUp }
    : { best: null, confidence: bestConf, runnerUp };
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
