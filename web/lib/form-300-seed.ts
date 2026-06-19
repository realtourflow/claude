/**
 * FORM 300 (Birmingham buy-side purchase agreement) — the first FULLY-KNOWN form
 * in the recognition library. Seeded directly from Paul's hand-built DocuSign
 * Envelope Template: every tab's exact position, type, Data Label, and signer
 * role was read via the API (scripts/capture-form300.ts) into
 * lib/form-ai/form-300-known.json. So a recognized FORM 300 gets EXACT placement
 * with zero vision guessing.
 *
 * The underlying PDF is flat (no AcroForm fields), so it's recognized by the
 * blank's CONTENT hash ("flat:"+sha256), not the structure fingerprint — see
 * matchFlatKnownForm. The 88 fields are cataloged ON THIS ENTRY; only the handful
 * that map to a universal registry core key carry one — the FORM-300-specific
 * elections/contingencies stay form-local (core_key null), never added to the
 * universal core list.
 */
import data from "./form-ai/form-300-known.json";
import { prisma } from "./db";
import type { KnownField } from "./known-forms";

// FORM 300 labels that map to a universal registry core key (auto-filled from the
// deal). Everything else is FORM-300-specific (core_key null). NOTE: many of the
// "specific" text fields still auto-fill at SEND via CONTRACT_FIELD_ALIASES, which
// keys off the Data Label (property_city→city, ppin→parcel_or_ppin, …) — that's
// the send path, not the core registry.
const CORE_KEY_BY_LABEL: Record<string, string> = {
  buyer_name: "buyer_name",
  purchase_price: "purchase_price",
  earnest_money_amount: "earnest_money_amount",
  closing_date: "closing_date",
  legal_description: "legal_description",
};

export const FORM_300_FINGERPRINT = `flat:${data.fileSha256}`;
export const FORM_300_ROLE_MAPPING: Record<string, string> = {
  buyer: "Buyer1",
  seller: "Seller1",
  agent: "BuyerAgent",
};

type RawField = {
  role: string;
  label: string;
  type: string;
  page: number;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
};

/** The 88 captured tabs as catalog KnownFields (positions in PDF points, bottom-left). */
export function form300KnownFields(): KnownField[] {
  return (data.fields as RawField[]).map((f) => ({
    detected_name: f.label,
    detected_type: f.type,
    effective_type: f.type,
    page_number: f.page,
    pos_x: f.pos_x,
    pos_y: f.pos_y,
    width: f.width,
    height: f.height,
    core_key: CORE_KEY_BY_LABEL[f.label] ?? null,
    role: f.role,
    // Read from Paul's verified template — known, not an AI guess. No review.
    needs_review: false,
  }));
}

export function form300SeedRow() {
  const fields = form300KnownFields();
  return {
    label: "FORM 300 — Birmingham General/Financed Residential Contract",
    side: "buy",
    board: "BIRMINGHAM_AAR",
    purpose: "",
    fingerprint: FORM_300_FINGERPRINT,
    field_count: fields.length,
    page_count: data.pageCount,
    fields,
    role_mapping: FORM_300_ROLE_MAPPING,
  };
}

/** Idempotent seed — upsert by the unique (fingerprint, board). */
export async function seedForm300(createdBy?: string): Promise<{ id: string; field_count: number }> {
  const row = form300SeedRow();
  const common = {
    label: row.label,
    side: row.side,
    board: row.board,
    purpose: row.purpose,
    field_count: row.field_count,
    page_count: row.page_count,
    fields: row.fields as object,
    role_mapping: row.role_mapping as object,
    active: true,
  };
  const existing = await prisma.known_forms.findFirst({
    where: { fingerprint: row.fingerprint, board: row.board },
    select: { id: true },
  });
  if (existing) {
    await prisma.known_forms.update({ where: { id: existing.id }, data: common });
    return { id: existing.id, field_count: row.field_count };
  }
  const created = await prisma.known_forms.create({
    data: { ...common, fingerprint: row.fingerprint, created_by: createdBy ?? null },
    select: { id: true },
  });
  return { id: created.id, field_count: row.field_count };
}
