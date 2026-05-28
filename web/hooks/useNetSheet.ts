"use client";

import { useState, useEffect, useCallback } from 'react';
import { api } from "@/lib/api-client";

export type NetSheetLine = {
  id: string;
  label: string;
  category: 'commission' | 'title' | 'taxes' | 'proration' | 'payoff' | 'optional' | 'custom';
  amount: number;
  pct: number | null;
  isPct: boolean;
  required: boolean;
  enabled: boolean;
  editable: boolean;
  autoPopulated: boolean;
};

export type NetSheet = {
  id: string;
  dealId: string;
  salePrice: number;
  closingDate: string | null;
  annualTaxes: number;
  lines: NetSheetLine[];
  status: 'draft' | 'ready';
  readyAt: string | null;
};

type ApiNetSheet = {
  id: string;
  deal_id: string;
  sale_price: number;
  closing_date: string | null;
  annual_taxes: number;
  lines: ApiNetSheetLine[];
  status: string;
  ready_at: string | null;
};

type ApiNetSheetLine = {
  id: string;
  label: string;
  category: string;
  amount: number;
  pct?: number | null;
  is_pct: boolean;
  required: boolean;
  enabled: boolean;
  editable: boolean;
  auto_populated: boolean;
};

function lineFromApi(l: ApiNetSheetLine): NetSheetLine {
  return {
    id: l.id,
    label: l.label,
    category: l.category as NetSheetLine['category'],
    amount: l.amount,
    pct: l.pct ?? null,
    isPct: l.is_pct,
    required: l.required,
    enabled: l.enabled,
    editable: l.editable,
    autoPopulated: l.auto_populated,
  };
}

function lineToApi(l: NetSheetLine): ApiNetSheetLine {
  return {
    id: l.id,
    label: l.label,
    category: l.category,
    amount: l.amount,
    pct: l.pct,
    is_pct: l.isPct,
    required: l.required,
    enabled: l.enabled,
    editable: l.editable,
    auto_populated: l.autoPopulated,
  };
}

function fromApi(ns: ApiNetSheet): NetSheet {
  return {
    id: ns.id,
    dealId: ns.deal_id,
    salePrice: ns.sale_price,
    closingDate: ns.closing_date ?? null,
    annualTaxes: ns.annual_taxes,
    lines: (ns.lines ?? []).map(lineFromApi),
    status: ns.status as 'draft' | 'ready',
    readyAt: ns.ready_at ?? null,
  };
}

// Recalculates percentage-based line amounts against the current sale price.
// Pure function — call whenever salePrice or lines change in the UI.
export function recalcLines(lines: NetSheetLine[], salePrice: number, annualTaxes: number, closingDate: string | null): NetSheetLine[] {
  return lines.map((line) => {
    if (!line.isPct || line.pct === null) return line;
    if (line.id === 'property_tax_proration') {
      if (annualTaxes > 0 && closingDate) {
        const d = new Date(closingDate);
        const start = new Date(d.getFullYear(), 0, 1);
        const dayOfYear = Math.floor((d.getTime() - start.getTime()) / 86_400_000) + 1;
        return { ...line, amount: Math.round(annualTaxes * (dayOfYear / 365)) };
      }
      return { ...line, amount: 0 };
    }
    return { ...line, amount: Math.round(salePrice * (line.pct / 100)) };
  });
}

export function calcNetProceeds(lines: NetSheetLine[], salePrice: number): number {
  const deductions = lines
    .filter((l) => l.enabled)
    .reduce((sum, l) => sum + l.amount, 0);
  return salePrice - deductions;
}

export function useNetSheet(dealId: string | undefined) {
  const [sheet, setSheet] = useState<NetSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [notReady, setNotReady] = useState(false);

  const load = useCallback(async () => {
    if (!dealId) { setLoading(false); return; }
    try {
      setLoading(true);
      setNotReady(false);
      const raw = await api.get<ApiNetSheet>(`/deals/${dealId}/net-sheet`);
      setSheet(fromApi(raw));
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('403')) setNotReady(true);
      setSheet(null);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { load(); }, [load]);

  async function saveSheet(s: NetSheet) {
    if (!dealId) return;
    const raw = await api.put<ApiNetSheet>(`/deals/${dealId}/net-sheet`, {
      sale_price: s.salePrice,
      closing_date: s.closingDate || null,
      annual_taxes: s.annualTaxes,
      lines: s.lines.map(lineToApi),
    });
    setSheet(fromApi(raw));
  }

  async function markReady(ready: boolean) {
    if (!dealId) return;
    const raw = await api.post<ApiNetSheet>(`/deals/${dealId}/net-sheet/ready`, { ready });
    setSheet(fromApi(raw));
  }

  return { sheet, loading, notReady, refresh: load, saveSheet, markReady };
}
