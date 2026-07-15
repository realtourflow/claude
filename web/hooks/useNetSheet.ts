"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
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

// Builds an agent-added custom deduction line (#181). Custom lines are
// optional (required: false) so the existing editor renders them in the
// optional-lines section with the enable toggle and amount editing for free;
// they persist through PUT /deals/:id/net-sheet like any other line.
export function createCustomLine(label: string, amount: number): NetSheetLine {
  return {
    id: `custom_${crypto.randomUUID()}`,
    label,
    category: 'custom',
    amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0,
    pct: null,
    isPct: false,
    required: false,
    enabled: true,
    editable: true,
    autoPopulated: false,
  };
}

// Recalculates percentage-based line amounts against the current sale price.
// Pure function — call whenever salePrice or lines change in the UI.
export function recalcLines(lines: NetSheetLine[], salePrice: number, annualTaxes: number, closingDate: string | null): NetSheetLine[] {
  return lines.map((line) => {
    if (!line.isPct || line.pct === null) return line;
    if (line.id === 'property_tax_proration') {
      if (annualTaxes > 0 && closingDate) {
        // closingDate is date-only — "2026-01-01" from the date input, or the
        // API shape "2026-01-01T00:00:00.000Z". Parse the Y/M/D prefix and do
        // every calculation in UTC: new Date()/getFullYear() mix UTC midnight
        // with local getters, so in a negative-offset zone a Jan 1 close flips
        // to the prior Dec 31 and prorates ~a full year. Divide by the actual
        // days in that year (365/366) so leap years prorate correctly and the
        // amount never exceeds the annual bill.
        const [year, month, day] = closingDate.slice(0, 10).split('-').map(Number);
        if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
          const yearStart = Date.UTC(year, 0, 1);
          const dayOfYear = Math.floor((Date.UTC(year, month - 1, day) - yearStart) / 86_400_000) + 1;
          const daysInYear = (Date.UTC(year + 1, 0, 1) - yearStart) / 86_400_000;
          return { ...line, amount: Math.round(annualTaxes * (dayOfYear / daysInYear)) };
        }
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

type NetSheetResult = { sheet: NetSheet | null; notReady: boolean };

export function useNetSheet(dealId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['net-sheet', dealId ?? ''];

  const query = useQuery<NetSheetResult>({
    queryKey,
    queryFn: async () => {
      try {
        const raw = await api.get<ApiNetSheet>(`/deals/${dealId}/net-sheet`);
        return { sheet: fromApi(raw), notReady: false };
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        return { sheet: null, notReady: msg.includes('403') };
      }
    },
    enabled: Boolean(dealId),
  });

  async function saveSheet(s: NetSheet) {
    if (!dealId) return;
    const raw = await api.put<ApiNetSheet>(`/deals/${dealId}/net-sheet`, {
      sale_price: s.salePrice,
      closing_date: s.closingDate || null,
      annual_taxes: s.annualTaxes,
      lines: s.lines.map(lineToApi),
    });
    queryClient.setQueryData<NetSheetResult>(queryKey, { sheet: fromApi(raw), notReady: false });
  }

  async function markReady(ready: boolean) {
    if (!dealId) return;
    const raw = await api.post<ApiNetSheet>(`/deals/${dealId}/net-sheet/ready`, { ready });
    queryClient.setQueryData<NetSheetResult>(queryKey, { sheet: fromApi(raw), notReady: false });
  }

  return {
    sheet: query.data?.sheet ?? null,
    loading: query.isLoading,
    notReady: query.data?.notReady ?? false,
    refresh: () => { void query.refetch(); },
    saveSheet,
    markReady,
  };
}
