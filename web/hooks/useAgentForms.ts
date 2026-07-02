"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export type FormSide = "buy" | "sell" | "both";
export type FormStatus =
  | "detecting"
  | "pending_review"
  | "pending_split"
  | "ready"
  | "rejected"
  | "archived";

export type FormType = {
  key: string;
  label: string;
  description: string;
  side: string;
  field_count: number;
};

export type UploadedForm = {
  id: string;
  label: string;
  side: FormSide;
  status: FormStatus;
  fileName: string;
  fieldCount: number;
  needsReviewCount: number;
  createdAt: string;
};

type ApiForm = {
  id: string;
  label: string;
  side: string;
  status: string;
  source_file_name: string;
  field_count: number;
  needs_review_count: number;
  created_at: string;
};

function fromApi(f: ApiForm): UploadedForm {
  return {
    id: f.id,
    label: f.label,
    side: f.side as FormSide,
    status: f.status as FormStatus,
    fileName: f.source_file_name,
    fieldCount: f.field_count,
    needsReviewCount: f.needs_review_count,
    createdAt: f.created_at,
  };
}

export function useAgentForms() {
  const queryClient = useQueryClient();
  const queryKey = ["me-forms"];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const raw = await api.get<ApiForm[]>("/me/forms");
      return raw.map(fromApi);
    },
  });

  // The document types the agent can declare on upload (selects the field set).
  const typesQuery = useQuery({
    queryKey: ["me-form-types"],
    queryFn: () => api.get<FormType[]>("/me/form-types"),
  });

  // Upload a blank form: presign → PUT to S3 → confirm (runs the AI pipeline).
  // `attested` MUST be true — the server rejects the confirm otherwise.
  // `formType` is the agent's declared document type (key in form_types).
  async function uploadForm(
    file: File,
    label: string,
    side: FormSide,
    attested: boolean,
    formType: string,
    bundle = false
  ): Promise<UploadedForm> {
    const mimeType = file.type || "application/pdf";

    const { upload_url, s3_key } = await api.post<{
      upload_url: string;
      s3_key: string;
    }>("/me/forms/upload-url", { file_name: file.name, mime_type: mimeType });

    const s3Res = await fetch(upload_url, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": mimeType },
    });
    if (!s3Res.ok) {
      throw new Error(`S3 upload failed (${s3Res.status} ${s3Res.statusText})`);
    }

    const raw = await api.post<ApiForm>("/me/forms", {
      label: label.trim(),
      side,
      file_name: file.name,
      s3_key,
      mime_type: mimeType,
      attestation: attested,
      form_type: formType,
      bundle,
    });

    const form = fromApi(raw);
    queryClient.setQueryData<UploadedForm[]>(queryKey, (prev) => [
      form,
      ...(prev ?? []),
    ]);
    return form;
  }

  async function getAttestation(): Promise<string> {
    const { statement } = await api.get<{ statement: string }>(
      "/me/forms/attestation"
    );
    return statement;
  }

  return {
    forms: query.data ?? [],
    loading: query.isLoading,
    formTypes: typesQuery.data ?? [],
    refresh: () => {
      void query.refetch();
    },
    uploadForm,
    getAttestation,
  };
}
