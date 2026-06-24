/**
 * Document TYPE seeds (Layer 2 of the form pipeline). A TYPE is the position-FREE
 * field set that ANY brokerage's version of a document needs — the answer key
 * guided vision locates on a new layout, and the source of which fields auto-fill
 * from the deal. Unlike a known_form (a specific reviewed LAYOUT, with
 * coordinates), a type carries NO positions.
 *
 * The catalog (10 document types, 274 fields) is generated from the human-edited
 * master list lib/form-ai/master-field-list.csv into lib/form-ai/form-types.json by
 * scripts/gen_form_types.py — regenerate after editing the CSV. "purchase_agreement"
 * is the lead type; FORM 300 is ONE known layout of it (known_forms.type_id, linked
 * in lib/form-300-seed).
 */
import formTypes from "./form-ai/form-types.json";
import { prisma } from "./db";
import { isCoreKey } from "./form-ai/core-keys";

export const PURCHASE_AGREEMENT_KEY = "purchase_agreement";

/** One field in a TYPE's position-free field set. No coordinates by design. */
export type TypeField = {
  label: string;
  type: string;
  role: string;
  // How universal the field is across layouts: "core" must be locatable on any
  // version; "common" appears on most. Drives guided-vision recall weighting.
  tier: "core" | "common";
  // Registry core key the field auto-fills from (lib/form-ai/core-keys), or null
  // for manual fields. Election sets (financing_type, agency_role) legitimately
  // share one key across their checkboxes — the deal's scalar value picks the box.
  core_key: string | null;
  required: boolean;
  source: string;
  note?: string;
};

export type FormTypeSeed = {
  key: string;
  label: string;
  description: string;
  side: string;
  fields: TypeField[];
};

const TYPES: FormTypeSeed[] = (
  formTypes as Array<{
    key: string;
    label: string;
    description: string;
    side: string;
    fields: unknown[];
  }>
).map((t) => ({
  key: t.key,
  label: t.label,
  description: t.description,
  side: t.side,
  fields: t.fields as unknown as TypeField[],
}));

/** Every document type's key, in catalog order. */
export const FORM_TYPE_KEYS = TYPES.map((t) => t.key);

/** All seedable document types (the full 10-type master catalog). */
export function formTypeSeeds(): FormTypeSeed[] {
  return TYPES;
}

/**
 * Idempotent seed of the document-type catalog — upsert by the unique `key`.
 * Guards that every field's core_key (when set) is a real registry key, so a
 * stale curation can't silently introduce a key the auto-fill mapper ignores.
 */
export async function seedFormTypes(): Promise<{ key: string; field_count: number }[]> {
  const results: { key: string; field_count: number }[] = [];
  for (const t of formTypeSeeds()) {
    for (const f of t.fields) {
      if (f.core_key && !isCoreKey(f.core_key)) {
        throw new Error(
          `form type ${t.key}: field "${f.label}" has unknown core_key "${f.core_key}"`
        );
      }
    }
    const data = {
      label: t.label,
      description: t.description,
      side: t.side,
      field_set: t.fields as object,
      field_count: t.fields.length,
      active: true,
    };
    const existing = await prisma.form_types.findUnique({
      where: { key: t.key },
      select: { id: true },
    });
    if (existing) {
      await prisma.form_types.update({ where: { id: existing.id }, data });
    } else {
      await prisma.form_types.create({ data: { key: t.key, ...data } });
    }
    results.push({ key: t.key, field_count: t.fields.length });
  }
  return results;
}

/** Resolve a document type's id by key (the best-effort link target for known_forms). */
export async function resolveFormTypeId(key: string): Promise<string | null> {
  const t = await prisma.form_types.findUnique({
    where: { key },
    select: { id: true },
  });
  return t?.id ?? null;
}
