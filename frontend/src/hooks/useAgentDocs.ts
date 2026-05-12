import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

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
  const [docs, setDocs] = useState<AgentDocTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const raw = await api.get<ApiDoc[]>('/me/doc-templates');
      setDocs(raw.map(fromApi));
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function uploadDoc(
    file: File,
    docType: DocType,
    name: string,
    notes: string,
  ): Promise<AgentDocTemplate> {
    // Step 1: get presigned URL
    const { upload_url, s3_key } = await api.post<{ upload_url: string; s3_key: string }>(
      '/me/doc-templates/upload-url',
      { file_name: file.name, mime_type: file.type || 'application/octet-stream' },
    );

    // Step 2: PUT file directly to S3
    await fetch(upload_url, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
    });

    // Step 3: confirm in DB
    const raw = await api.post<ApiDoc>('/me/doc-templates', {
      name: name.trim() || DOC_TYPE_LABELS[docType],
      doc_type: docType,
      file_name: file.name,
      s3_key,
      mime_type: file.type || 'application/octet-stream',
      file_size: file.size,
      notes: notes.trim() || null,
    });

    const doc = fromApi(raw);
    setDocs((prev) => [doc, ...prev]);
    return doc;
  }

  async function updateDoc(id: string, patch: { name?: string; notes?: string | null }): Promise<void> {
    const raw = await api.patch<ApiDoc>(`/me/doc-templates/${id}`, patch);
    const updated = fromApi(raw);
    setDocs((prev) => prev.map((d) => (d.id === id ? updated : d)));
  }

  async function removeDoc(id: string): Promise<void> {
    await api.delete(`/me/doc-templates/${id}`);
    setDocs((prev) => prev.filter((d) => d.id !== id));
  }

  async function getDownloadUrl(id: string): Promise<string> {
    const { download_url } = await api.get<{ download_url: string }>(
      `/me/doc-templates/${id}/download-url`,
    );
    return download_url;
  }

  return { docs, loading, refresh: load, uploadDoc, updateDoc, removeDoc, getDownloadUrl };
}

export function useAgentDocTemplatesForDeal(dealId: string | undefined) {
  const [templates, setTemplates] = useState<AgentDocTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!dealId) { setLoading(false); return; }
    setLoading(true);
    api.get<ApiDoc[]>(`/deals/${dealId}/agent-doc-templates`)
      .then((raw) => setTemplates(raw.map(fromApi)))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, [dealId]);

  async function getDownloadUrl(id: string): Promise<string> {
    const { download_url } = await api.get<{ download_url: string }>(
      `/me/doc-templates/${id}/download-url`,
    );
    return download_url;
  }

  return { templates, loading, getDownloadUrl };
}
