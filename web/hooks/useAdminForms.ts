"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export type AdminFormSummary = {
  id: string;
  label: string;
  side: string;
  status: string;
  source_file_name: string;
  agent_name: string;
  field_count: number;
  needs_review_count: number;
  created_at: string;
};

export type AdminFormField = {
  id: string;
  detected_name: string;
  detected_type: string;
  page_number: number;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  tier: string; // "core" | "common" — overlay color coding
  ai_core_key: string | null;
  ai_role: string | null;
  ai_confidence: number | null;
  ai_rationale: string;
  needs_review: boolean;
  final_core_key: string | null;
  final_role: string | null;
  final_type: string | null;
  decision: string;
};

export type CoreKey = { key: string; kind: string; description: string };

// One entry in the document type's master field list — the source for the overlay's
// "add a field vision missed" picker.
export type TypeFieldOption = {
  label: string;
  type: string;
  role: string;
  tier: string; // "core" | "common"
  core_key: string | null;
  required: boolean;
};

// Body for adding a field the admin places during review.
export type NewField = {
  detected_name: string;
  detected_type: string;
  page_number: number;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  final_core_key?: string | null;
  final_role?: string | null;
};

export type AdminFormDetail = {
  id: string;
  label: string;
  side: string;
  status: string;
  source_file_name: string;
  agent_name: string;
  agent_email: string;
  attestation_statement: string;
  attested_at: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  docusign_template_id: string | null;
  detection_source: string; // "acroform" | "recognized" | "vision"
  placement_confirmed_at: string | null;
  preview_url: string;
  pages: Array<{ page: number; width: number; height: number }>;
  core_keys: CoreKey[];
  type_fields: TypeFieldOption[];
  derived_signers: {
    roleMapping: Record<string, string>;
    routing: string;
    consumerRoles: string[];
  };
  fields: AdminFormField[];
};

export type FieldPatch = Partial<{
  final_core_key: string | null;
  final_role: string | null;
  final_type: string;
  decision: string;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
}>;

export function useAdminFormsList(status = "pending_review") {
  return useQuery({
    queryKey: ["admin-forms", status],
    queryFn: () => api.get<AdminFormSummary[]>(`/admin/forms?status=${status}`),
  });
}

export function useAdminForm(id: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-form", id ?? ""],
    queryFn: () => api.get<AdminFormDetail>(`/admin/forms/${id}`),
    enabled: !!id,
  });

  async function patchField(fieldId: string, patch: FieldPatch): Promise<void> {
    await api.patch<AdminFormField>(`/admin/forms/${id}/fields/${fieldId}`, patch);
    await query.refetch();
  }

  // Overlay drag-END: persist a box's new position. The overlay keeps its own live
  // box state, so the refetch (which syncs the now-cleared placement_confirmed_at →
  // re-arming the approve gate) doesn't disturb the drag, and returns the same
  // coords the overlay already shows.
  async function saveFieldPosition(
    fieldId: string,
    pos: { pos_x: number; pos_y: number; width: number; height: number }
  ): Promise<void> {
    await api.patch<AdminFormField>(`/admin/forms/${id}/fields/${fieldId}`, pos);
    await query.refetch();
  }

  // Shift every box on one page up (dy>0) or down by dy points, in one save —
  // the fast fix for vision's per-page vertical offset. Clears confirmation.
  async function nudgePage(page: number, dy: number): Promise<void> {
    await api.post(`/admin/forms/${id}/nudge-page`, { page, dy });
    await query.refetch();
  }

  // Add a field vision missed (from the type's master list or custom), pre-placed
  // at a default spot the admin then drags onto its blank. Clears confirmation.
  // Returns the new field's id + page so the overlay can scroll to + flash it.
  async function addField(field: NewField): Promise<{ id: string; page_number: number }> {
    const created = await api.post<{ id: string; page_number: number }>(
      `/admin/forms/${id}/fields`,
      field
    );
    await query.refetch();
    return created;
  }

  // Remove a box vision put on the wrong thing. Clears confirmation.
  async function deleteField(fieldId: string): Promise<void> {
    await api.delete(`/admin/forms/${id}/fields/${fieldId}`);
    await query.refetch();
  }

  // The human "boxes are right" sign-off that satisfies the mandatory placement gate.
  async function confirmPlacement(): Promise<void> {
    await api.post(`/admin/forms/${id}/confirm-placement`, {});
    await query.refetch();
  }

  async function approve(signers?: {
    role_mapping: Record<string, string>;
    routing?: string;
    consumer_roles?: string[];
  }): Promise<void> {
    await api.post(`/admin/forms/${id}`, {
      action: "approve",
      ...(signers ? { signers } : {}),
    });
    await query.refetch();
    void queryClient.invalidateQueries({ queryKey: ["admin-forms"] });
  }

  async function reject(notes: string): Promise<void> {
    await api.post(`/admin/forms/${id}`, { action: "reject", review_notes: notes });
    await query.refetch();
    void queryClient.invalidateQueries({ queryKey: ["admin-forms"] });
  }

  return {
    detail: query.data,
    loading: query.isLoading,
    patchField,
    saveFieldPosition,
    nudgePage,
    addField,
    deleteField,
    confirmPlacement,
    approve,
    reject,
    refetch: () => query.refetch(),
  };
}
