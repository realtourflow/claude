"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export type DocType = 'baa' | 'listing_agreement' | 'purchase_contract' | 'disclosure' | 'other';

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  baa:               'Buyer Agency Agreement',
  listing_agreement: 'Exclusive Listing Agreement',
  purchase_contract: 'Purchase Contract',
  disclosure:        'Disclosure Form',
  other:             'Other',
};

export type AgentDocTemplate = {
  id: string;
  agentId: string;
  name: string;
  docType: DocType;
  fileName: string;
  s3Key: string;
  mimeType: string;
  fileSize: number;
  notes: string | null;
  createdAt: string;
};

type ApiDoc = {
  id: string;
  agent_id: string;
  name: string;
  doc_type: string;
  file_name: string;
  s3_key: string;
  mime_type: string;
  file_size: number;
  notes: string | null;
  created_at: string;
};

function fromApi(d: ApiDoc): AgentDocTemplate {
  return {
    id: d.id,
    agentId: d.agent_id,
    name: d.name,
    docType: d.doc_type as DocType,
    fileName: d.file_name,
    s3Key: d.s3_key,
    mimeType: d.mime_type,
    fileSize: d.file_size,
    notes: d.notes,
    createdAt: d.created_at,
  };
}

export function useAgentDocs() {
  const queryClient = useQueryClient();
  const queryKey = ['me-doc-templates'];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const raw = await api.get<ApiDoc[]>('/me/doc-templates');
      return raw.map(fromApi);
    },
  });

  async function uploadDoc(
    file: File,
    docType: DocType,
    name: string,
    notes: string,
  ): Promise<AgentDocTemplate> {
    const mimeType = file.type || 'application/octet-stream';

    // Step 1: get presigned URL
    const { upload_url, s3_key } = await api.post<{ upload_url: string; s3_key: string }>(
      '/me/doc-templates/upload-url',
      { file_name: file.name, mime_type: mimeType },
    );

    // Step 2: PUT file directly to S3
    const s3Res = await fetch(upload_url, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': mimeType },
    });
    if (!s3Res.ok) {
      throw new Error(`S3 upload failed (${s3Res.status} ${s3Res.statusText})`);
    }

    // Step 3: confirm in DB
    const raw = await api.post<ApiDoc>('/me/doc-templates', {
      name: name.trim() || DOC_TYPE_LABELS[docType],
      doc_type: docType,
      file_name: file.name,
      s3_key,
      mime_type: mimeType,
      file_size: file.size,
      notes: notes.trim() || null,
    });

    const doc = fromApi(raw);
    queryClient.setQueryData<AgentDocTemplate[]>(queryKey, (prev) => [doc, ...(prev ?? [])]);
    return doc;
  }

  async function updateDoc(id: string, patch: { name?: string; notes?: string | null }): Promise<void> {
    const raw = await api.patch<ApiDoc>(`/me/doc-templates/${id}`, patch);
    const updated = fromApi(raw);
    queryClient.setQueryData<AgentDocTemplate[]>(queryKey, (prev) =>
      (prev ?? []).map((d) => (d.id === id ? updated : d)),
    );
  }

  async function removeDoc(id: string): Promise<void> {
    await api.delete(`/me/doc-templates/${id}`);
    queryClient.setQueryData<AgentDocTemplate[]>(queryKey, (prev) =>
      (prev ?? []).filter((d) => d.id !== id),
    );
  }

  async function getDownloadUrl(id: string): Promise<string> {
    const { download_url } = await api.get<{ download_url: string }>(
      `/me/doc-templates/${id}/download-url`,
    );
    return download_url;
  }

  return {
    docs: query.data ?? [],
    loading: query.isLoading,
    refresh: () => { void query.refetch(); },
    uploadDoc,
    updateDoc,
    removeDoc,
    getDownloadUrl,
  };
}

export function useAgentDocTemplatesForDeal(dealId: string | undefined) {
  const query = useQuery({
    queryKey: ['agent-doc-templates', dealId ?? ''],
    queryFn: async () => {
      try {
        const raw = await api.get<ApiDoc[]>(`/deals/${dealId}/agent-doc-templates`);
        return raw.map(fromApi);
      } catch {
        return [] as AgentDocTemplate[];
      }
    },
    enabled: Boolean(dealId),
  });

  async function getDownloadUrl(id: string): Promise<string> {
    const { download_url } = await api.get<{ download_url: string }>(
      `/me/doc-templates/${id}/download-url`,
    );
    return download_url;
  }

  return { templates: query.data ?? [], loading: query.isLoading, getDownloadUrl };
}
