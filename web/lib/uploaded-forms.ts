/**
 * Agent form-upload pipeline helpers: the licensing attestation source, the
 * detect→map step that writes uploaded_form_fields rows, and shared constants.
 * Kept out of the route handlers so the pipeline is unit-testable.
 */
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { prisma } from "./db";
import { getFieldMapper } from "./form-ai/mapper";
import { CORE_KEYS } from "./form-ai/core-keys";
import type { CoreKeyProposal, DetectedField } from "./form-ai/types";
import type { TemplateSignerSpec, TemplateTabSpec } from "./docusign";

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

// A uploaded_form_fields row (Decimal columns are typed loosely so the same
// serializer works on a Prisma row regardless of select shape).
export type FormFieldRow = {
  id: string;
  detected_name: string;
  detected_type: string;
  page_number: number;
  pos_x: unknown;
  pos_y: unknown;
  width: unknown;
  height: unknown;
  nearby_text: string;
  ai_core_key: string | null;
  ai_role: string | null;
  ai_confidence: unknown;
  ai_rationale: string;
  needs_review: boolean;
  final_core_key: string | null;
  final_role: string | null;
  final_type: string | null;
  decision: string;
};

const toNum = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

// ─── Template assembly (admin approval) ────────────────────────────────────

// A field row as needed to build the DocuSign template (Prisma row is wider).
export type ApprovedFieldRow = {
  detected_name: string;
  detected_type: string;
  page_number: number;
  pos_x: unknown;
  pos_y: unknown;
  width: unknown;
  height: unknown;
  ai_core_key: string | null;
  ai_role: string | null;
  final_core_key: string | null;
  final_role: string | null;
  final_type: string | null;
  decision: string;
};

type Effective = { coreKey: string | null; role: string | null; type: string; label: string };

// The decided values for a field: the admin's correction if touched, else the
// AI proposal. label is the DocuSign tab data label — the core key when mapped
// (so prefill matches), else the detected name (a blank the signer fills).
function effective(f: ApprovedFieldRow): Effective {
  const touched = f.decision !== "pending";
  const coreKey = touched ? f.final_core_key : f.ai_core_key;
  const role = (touched ? f.final_role : f.ai_role) ?? null;
  const type = (touched ? f.final_type : f.detected_type) ?? f.detected_type ?? "text";
  return { coreKey, role, type, label: coreKey ?? f.detected_name };
}

function normalizeParticipant(templateRole: string): string {
  const r = templateRole.toLowerCase();
  if (r.includes("buyer")) return "buyer";
  if (r.includes("seller")) return "seller";
  if (r.includes("agent")) return "agent";
  return r;
}

export type SignersConfig = {
  roleMapping: Record<string, string>;
  routing: "by-role" | "consumers";
  consumerRoles: string[];
};

// The "derive" half of derive-then-confirm: a by-role signers config inferred
// from the roles assigned to the form's fields. The admin can override it at
// approval. Falls back to one role keyed off the form's side.
export function deriveSigners(fields: ApprovedFieldRow[], side: FormSide): SignersConfig {
  const roles: string[] = [];
  for (const f of fields) {
    const role = effective(f).role;
    if (role && !roles.includes(role)) roles.push(role);
  }
  if (roles.length === 0) roles.push(side === "sell" ? "Seller" : "Buyer");
  const roleMapping: Record<string, string> = {};
  for (const role of roles) roleMapping[normalizeParticipant(role)] = role;
  return { roleMapping, routing: "by-role", consumerRoles: [] };
}

type TabBucket =
  | "textTabs"
  | "checkboxTabs"
  | "signHereTabs"
  | "initialHereTabs"
  | "dateSignedTabs";

const TAB_BUCKET: Record<string, TabBucket> = {
  text: "textTabs",
  checkbox: "checkboxTabs",
  signature: "signHereTabs",
  initial: "initialHereTabs",
  date: "dateSignedTabs",
};

/**
 * Builds DocuSign template signer specs from the approved fields — converting
 * each field's PDF rectangle (bottom-left origin) to DocuSign tab coordinates
 * (points from the page top-left) and grouping tabs under the signer that owns
 * them. Text/checkbox tabs are labeled with the core key (so prefill matches);
 * unmapped fillables keep the detected name. Fields with no role land on the
 * first role. This is what makes uploaded-form placement match a hand-built one.
 */
export async function buildTemplateSigners(input: {
  pdfBytes: Uint8Array;
  fields: ApprovedFieldRow[];
  roleMapping: Record<string, string>;
}): Promise<TemplateSignerSpec[]> {
  const doc = await PDFDocument.load(input.pdfBytes, { ignoreEncryption: true });
  const heights = doc.getPages().map((p) => p.getHeight());
  const fallbackHeight = heights[0] ?? 792;

  const roleNames = Array.from(new Set(Object.values(input.roleMapping)));
  if (roleNames.length === 0) roleNames.push("Signer");
  const signers = new Map<string, TemplateSignerSpec>();
  roleNames.forEach((roleName, i) =>
    signers.set(roleName, { roleName, recipientId: String(i + 1), routingOrder: i + 1 })
  );
  const defaultRole = roleNames[0];
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

  for (const f of input.fields) {
    const eff = effective(f);
    const bucket = TAB_BUCKET[eff.type] ?? "textTabs";
    const roleName = eff.role && signers.has(eff.role) ? eff.role : defaultRole;
    const signer = signers.get(roleName)!;

    const page = f.page_number || 1;
    const pageHeight = heights[page - 1] ?? fallbackHeight;
    const w = num(f.width);
    const h = num(f.height);
    // PDF rect is bottom-left origin; DocuSign yPosition is from the page top.
    const tab: TemplateTabSpec = {
      tabLabel: eff.label,
      pageNumber: page,
      x: num(f.pos_x),
      y: pageHeight - num(f.pos_y) - h,
      ...(bucket === "textTabs" ? { width: w, height: h } : {}),
    };
    (signer[bucket] ??= []).push(tab);
  }

  return roleNames.map((r) => signers.get(r)!);
}

/** Serializes a detected-field row to the API shape (Decimals → numbers). */
export function serializeFormField(f: FormFieldRow) {
  return {
    id: f.id,
    detected_name: f.detected_name,
    detected_type: f.detected_type,
    page_number: f.page_number,
    pos_x: toNum(f.pos_x),
    pos_y: toNum(f.pos_y),
    width: toNum(f.width),
    height: toNum(f.height),
    nearby_text: f.nearby_text,
    ai_core_key: f.ai_core_key,
    ai_role: f.ai_role,
    ai_confidence: toNum(f.ai_confidence),
    ai_rationale: f.ai_rationale,
    needs_review: f.needs_review,
    final_core_key: f.final_core_key,
    final_role: f.final_role,
    final_type: f.final_type,
    decision: f.decision,
  };
}
