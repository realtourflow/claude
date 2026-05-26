"use client";

import { useState, useCallback, useEffect } from 'react';
import { api } from '../api/client';

// ─── System Config ─────────────────────────────────────────────────────────────

export type StageThresholds = {
  intake: number;
  active_search: number;
  offer_active: number;
  under_contract: number;
  pre_close: number;
  closing: number;
  post_close: number;
};

export type SystemConfig = {
  stage_thresholds: StageThresholds;
  closing_fee_amount: number;
  fast_pass_base_price: number;
  smooth_exit_pct: number;
};

type ConfigResponse = { config: SystemConfig; updated_at: string };

export function useSystemConfig() {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<ConfigResponse>('/admin/config');
      setConfig(data.config ?? {});
      setUpdatedAt(data.updated_at);
    } catch {
      setError('Failed to load config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveConfig = useCallback(async (cfg: SystemConfig) => {
    setSaving(true);
    setError(null);
    try {
      const data = await api.put<ConfigResponse>('/admin/config', { config: cfg });
      setConfig(data.config);
      setUpdatedAt(data.updated_at);
    } catch {
      setError('Failed to save config');
      throw new Error('Failed to save config');
    } finally {
      setSaving(false);
    }
  }, []);

  return { config, updatedAt, loading, saving, error, saveConfig };
}

// ─── Promo Codes ───────────────────────────────────────────────────────────────

export type PromoCode = {
  id: string;
  code: string;
  discountType: 'pct' | 'fixed';
  discountValue: number;
  appliesTo: string[];
  maxUses: number | null;
  usesCount: number;
  expiresAt: string | null;
  createdAt: string;
};

function apiToPromoCode(raw: Record<string, unknown>): PromoCode {
  return {
    id: raw.id as string,
    code: raw.code as string,
    discountType: raw.discount_type as 'pct' | 'fixed',
    discountValue: raw.discount_value as number,
    appliesTo: (raw.applies_to as string[]) ?? [],
    maxUses: (raw.max_uses as number | null) ?? null,
    usesCount: raw.uses_count as number,
    expiresAt: (raw.expires_at as string | null) ?? null,
    createdAt: raw.created_at as string,
  };
}

// ─── Audit Log ─────────────────────────────────────────────────────────────────

export type AuditEntry = {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  eventType: string;
  dealId: string | null;
  dealTitle: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type AuditLogResponse = { entries: AuditEntry[]; total: number };

function apiToAuditEntry(raw: Record<string, unknown>): AuditEntry {
  return {
    id: raw.id as string,
    actorId: (raw.actor_id as string | null) ?? null,
    actorName: (raw.actor_name as string | null) ?? null,
    actorEmail: (raw.actor_email as string | null) ?? null,
    eventType: raw.event_type as string,
    dealId: (raw.deal_id as string | null) ?? null,
    dealTitle: (raw.deal_title as string | null) ?? null,
    targetId: (raw.target_id as string | null) ?? null,
    metadata: (raw.metadata as Record<string, unknown> | null) ?? null,
    createdAt: raw.created_at as string,
  };
}

export function useAuditLog(eventTypeFilter?: string) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = eventTypeFilter ? `?event_type=${encodeURIComponent(eventTypeFilter)}&limit=200` : '?limit=200';
      const data = await api.get<Record<string, unknown>>(`/admin/audit-log${qs}`);
      const resp = data as unknown as AuditLogResponse;
      setEntries((resp.entries ?? []).map((e) => apiToAuditEntry(e as unknown as Record<string, unknown>)));
      setTotal(resp.total ?? 0);
    } catch {
      setError('Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [eventTypeFilter]);

  useEffect(() => { load(); }, [load]);

  return { entries, total, loading, error };
}

export type CreatePromoCodeInput = {
  code: string;
  discountType: 'pct' | 'fixed';
  discountValue: number;
  appliesTo: string[];
  maxUses: number | null;
  expiresAt: string | null;
};

export function usePromoCodes() {
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Record<string, unknown>[]>('/admin/promo-codes');
      setCodes(data.map(apiToPromoCode));
    } catch {
      setError('Failed to load promo codes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createCode = useCallback(async (input: CreatePromoCodeInput) => {
    const raw = await api.post<Record<string, unknown>>('/admin/promo-codes', {
      code: input.code,
      discount_type: input.discountType,
      discount_value: input.discountValue,
      applies_to: input.appliesTo,
      max_uses: input.maxUses,
      expires_at: input.expiresAt,
    });
    const created = apiToPromoCode(raw);
    setCodes((prev) => [created, ...prev]);
    return created;
  }, []);

  const deleteCode = useCallback(async (id: string) => {
    setCodes((prev) => prev.filter((c) => c.id !== id));
    try {
      await api.delete<void>(`/admin/promo-codes/${id}`);
    } catch {
      // 204 No Content causes a JSON parse rejection — expected
    }
  }, []);

  return { codes, loading, error, createCode, deleteCode };
}
