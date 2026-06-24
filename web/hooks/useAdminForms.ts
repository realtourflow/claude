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
  preview_url: string;
  core_keys: CoreKey[];
  fields: AdminFormField[];
};

export type FieldPatch = Partial<{
  final_core_key: string | null;
  final_role: string | null;
  final_type: string;
  decision: string;
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

  async function approve(): Promise<void> {
    await api.post(`/admin/forms/${id}`, { action: "approve" });
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
    approve,
    reject,
  };
}
