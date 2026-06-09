/**
 * Vendor serialization shared by the /vendors route handlers.
 *
 * The DB columns contact_name/phone/email/website/notes are nullable, but the
 * frontend `ApiVendor` type (web/hooks/useVendors.ts) expects non-null strings.
 * `serializeVendor` coalesces NULL → "" so the wire shape matches exactly, and
 * emits `created_at` as an ISO string (the Go backend returned RFC3339 JSON).
 */

export type VendorRow = {
  id: string;
  agent_id: string;
  category: string;
  company: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  notes: string | null;
  is_featured: boolean;
  sort_order: number;
  created_at: Date;
};

export type ApiVendor = {
  id: string;
  agent_id: string;
  category: string;
  company: string;
  contact_name: string;
  phone: string;
  email: string;
  website: string;
  notes: string;
  is_featured: boolean;
  sort_order: number;
  created_at: string;
};

export function serializeVendor(v: VendorRow): ApiVendor {
  return {
    id: v.id,
    agent_id: v.agent_id,
    category: v.category,
    company: v.company,
    contact_name: v.contact_name ?? "",
    phone: v.phone ?? "",
    email: v.email ?? "",
    website: v.website ?? "",
    notes: v.notes ?? "",
    is_featured: v.is_featured,
    sort_order: v.sort_order,
    created_at: v.created_at.toISOString(),
  };
}
