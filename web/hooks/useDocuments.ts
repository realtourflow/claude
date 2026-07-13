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
  // '' | 'baa' — marks special documents (the buyer agency agreement).
  purpose?: string;
  // The VIEWER's own recipient status on this document's envelope (null when
  // they are not a signer). Drives the portal "Sign this document" button.
  myRecipientStatus?: string | null;
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
  purpose?: string;
  my_recipient_status?: string | null;
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
    purpose: d.purpose ?? undefined,
    myRecipientStatus: d.my_recipient_status ?? null,
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
): Promise<{ upload_url: string; client_upload_url?: string; s3_key: string }> {
  // client_upload_url (#189) is the direct-to-Blob grant route — preferred
  // byte path (no ~4.5MB function proxy); upload_url is the proxy fallback.
  return api.post<{ upload_url: string; client_upload_url?: string; s3_key: string }>(
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

// Preferred fallback-path send: deal participants by user id. The server
// derives routing (buyer → seller → agent) and marks portal users for
// embedded signing. Optional purpose ('baa') tags the buyer agency agreement.
export async function sendForSignatureByUserIds(
  dealId: string,
  documentId: string,
  signerUserIds: string[],
  purpose?: string,
): Promise<{ envelope_id: string; status: string }> {
  return api.post(`/deals/${dealId}/documents/${documentId}/send-for-signature`, {
    signer_user_ids: signerUserIds,
    ...(purpose ? { purpose } : {}),
  });
}

export type DocusignTemplate = {
  key: string;
  label: string;
  roles: string[];
  roleMapping: Record<string, string>;
  purpose: string;
  board: string;
  fieldMap: Record<string, { label: string; type: "text" | "checkbox"; role?: string }>;
};

// The standard forms configured in DOCUSIGN_TEMPLATES (feeds the form picker).
export async function listDocusignTemplates(): Promise<DocusignTemplate[]> {
  const res = await api.get<{ templates: DocusignTemplate[] }>(`/docusign/templates`);
  return res.templates;
}

export type TemplateAssignment = {
  role_name: string;
  user_id?: string;
  email?: string;
  name?: string;
};

export type ContractPrepField = {
  key: string;
  type: string;
  value: unknown;
  label?: string;
  role?: string;
};

export type ContractPrep = {
  form: { key: string; label: string; board: string };
  core: ContractPrepField[];
  board_fields: ContractPrepField[];
};

// The merged, prefilled field set the agent reviews before sending a form.
export async function getContractPrep(
  dealId: string,
  formKey: string,
): Promise<ContractPrep> {
  return api.get(`/deals/${dealId}/contracts/${formKey}/prep`);
}

// Shared core contract facts (one set per deal — every form reads them).
export async function saveContractFacts(
  dealId: string,
  facts: Record<string, unknown>,
): Promise<void> {
  await api.put(`/deals/${dealId}/contract-facts`, facts);
}

// Form-specific values, validated server-side against the form's fieldMap.
export async function saveContractTerms(
  dealId: string,
  formKey: string,
  terms: Record<string, unknown>,
): Promise<void> {
  await api.put(`/deals/${dealId}/contracts/${formKey}/terms`, { terms });
}

// PRIMARY send path: send a configured template. Roles auto-fill from the
// deal's participants server-side; assignments override individual roles
// (swap participant or hand a role to an outside email signer).
export async function sendTemplateForSignature(
  dealId: string,
  formKey: string,
  assignments?: TemplateAssignment[],
): Promise<{ envelope_id: string; status: string; document: ApiDocument }> {
  return api.post(`/deals/${dealId}/docusign/send-template`, {
    form_key: formKey,
    ...(assignments && assignments.length > 0 ? { assignments } : {}),
  });
}

// Disclosures are tracked, not sent: the lender delivers them out-of-band and
// RTF records completion (manual now; ARIVE feeds it in v2).
export async function setDisclosuresComplete(
  dealId: string,
  complete: boolean,
): Promise<{ disclosures_complete: boolean }> {
  return api.patch(`/deals/${dealId}/disclosures`, { complete });
}

// Embedded signing: mints a single-use (~5 min) recipient-view URL for the
// CALLER's slot on the document's envelope. Generated on click, never stored.
export async function getSigningUrl(
  dealId: string,
  documentId: string,
): Promise<string> {
  const res = await api.post<{ url: string }>(
    `/deals/${dealId}/documents/${documentId}/docusign/signing-url`,
    {},
  );
  return res.url;
}

export async function refreshDocuSignStatus(
  dealId: string,
  documentId: string,
): Promise<{ status: string }> {
  return api.post(`/deals/${dealId}/documents/${documentId}/docusign/refresh`, {});
}
