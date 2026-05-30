"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export type Document = {
  id: string;
  dealId: string;
  uploadedBy: string;
  uploaderName: string;
  name: string;
  s3Key: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
  envelopeId?: string;
  docusignStatus?: string;
  docusignSentAt?: string;
};

type ApiDocument = {
  id: string;
  deal_id: string;
  uploaded_by: string;
  uploader_name: string;
  name: string;
  s3_key: string;
  mime_type: string;
  file_size: number;
  created_at: string;
  docusign_envelope_id?: string;
  docusign_status?: string;
  docusign_sent_at?: string;
};

function apiDocToFrontend(d: ApiDocument): Document {
  return {
    id: d.id,
    dealId: d.deal_id,
    uploadedBy: d.uploaded_by,
    uploaderName: d.uploader_name,
    name: d.name,
    s3Key: d.s3_key,
    mimeType: d.mime_type,
    fileSize: d.file_size,
    createdAt: d.created_at,
    envelopeId: d.docusign_envelope_id,
    docusignStatus: d.docusign_status ?? undefined,
    docusignSentAt: d.docusign_sent_at ?? undefined,
  };
}

export function useDocuments(dealId: string): {
  docs: Document[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const query = useQuery({
    queryKey: ['documents', dealId],
    queryFn: async () => {
      const data = await api.get<ApiDocument[]>(`/deals/${dealId}/documents`);
      return data.map(apiDocToFrontend);
    },
    enabled: Boolean(dealId),
  });

  return {
    docs: query.data ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? 'Failed to load documents' : null,
    refresh: () => { void query.refetch(); },
  };
}

export async function requestUploadUrl(
  dealId: string,
  fileName: string,
  mimeType: string,
): Promise<{ upload_url: string; s3_key: string }> {
  return api.post<{ upload_url: string; s3_key: string }>(
    `/deals/${dealId}/documents/upload-url`,
    { file_name: fileName, mime_type: mimeType },
  );
}

export async function confirmUpload(
  dealId: string,
  name: string,
  s3Key: string,
  mimeType: string,
  fileSize: number,
): Promise<Document> {
  const d = await api.post<ApiDocument>(`/deals/${dealId}/documents`, {
    name,
    s3_key: s3Key,
    mime_type: mimeType,
    file_size: fileSize,
  });
  return apiDocToFrontend(d);
}

export async function getDownloadUrl(documentId: string): Promise<string> {
  const res = await api.get<{ download_url: string }>(`/documents/${documentId}/download-url`);
  return res.download_url;
}

export async function deleteDocument(documentId: string): Promise<void> {
  await api.delete<void>(`/documents/${documentId}`);
}

export async function sendForSignature(
  dealId: string,
  documentId: string,
  signers: { email: string; name: string }[],
): Promise<{ envelope_id: string; status: string }> {
  return api.post(`/deals/${dealId}/documents/${documentId}/send-for-signature`, { signers });
}

export async function refreshDocuSignStatus(
  dealId: string,
  documentId: string,
): Promise<{ status: string }> {
  return api.post(`/deals/${dealId}/documents/${documentId}/docusign/refresh`, {});
}
