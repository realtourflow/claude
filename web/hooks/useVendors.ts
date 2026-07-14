"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { VendorCategory } from "@/lib/vendor-categories";

export type Vendor = {
  id: string;
  agentId: string;
  category: VendorCategory;
  company: string;
  contactName: string;
  phone: string;
  email: string;
  website: string;
  notes: string;
  isFeatured: boolean;
  sortOrder: number;
  createdAt: string;
};

type ApiVendor = {
  id: string;
  agent_id: string;
  category: string;
  company: string;
  contact_name: string;
  phone: string;
  email: string;
  website: string;
  notes: string;
  is_featured: boolean;
  sort_order: number;
  created_at: string;
};

function apiVendorToFrontend(v: ApiVendor): Vendor {
  return {
    id: v.id,
    agentId: v.agent_id,
    category: v.category as VendorCategory,
    company: v.company,
    contactName: v.contact_name,
    phone: v.phone,
    email: v.email,
    website: v.website,
    notes: v.notes,
    isFeatured: v.is_featured,
    sortOrder: v.sort_order,
    createdAt: v.created_at,
  };
}

export type VendorInput = {
  category: VendorCategory;
  company: string;
  contactName?: string;
  phone?: string;
  email?: string;
  website?: string;
  notes?: string;
  isFeatured?: boolean;
};

export function useVendors() {
  const queryClient = useQueryClient();
  const queryKey = ['vendors'];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const data = await api.get<ApiVendor[]>('/vendors');
      return data.map(apiVendorToFrontend);
    },
  });

  const vendors = query.data ?? [];

  async function addVendor(input: VendorInput): Promise<Vendor> {
    const v = await api.post<ApiVendor>('/vendors', {
      category: input.category,
      company: input.company,
      contact_name: input.contactName ?? '',
      phone: input.phone ?? '',
      email: input.email ?? '',
      website: input.website ?? '',
      notes: input.notes ?? '',
      is_featured: input.isFeatured ?? false,
    });
    const vendor = apiVendorToFrontend(v);
    queryClient.setQueryData<Vendor[]>(queryKey, (prev) => [...(prev ?? []), vendor]);
    return vendor;
  }

  async function updateVendor(id: string, updates: Partial<VendorInput> & { sortOrder?: number }): Promise<void> {
    const body: Record<string, unknown> = {};
    if (updates.company !== undefined)     body.company      = updates.company;
    if (updates.contactName !== undefined) body.contact_name = updates.contactName;
    if (updates.phone !== undefined)       body.phone        = updates.phone;
    if (updates.email !== undefined)       body.email        = updates.email;
    if (updates.website !== undefined)     body.website      = updates.website;
    if (updates.notes !== undefined)       body.notes        = updates.notes;
    if (updates.isFeatured !== undefined)  body.is_featured  = updates.isFeatured;
    if (updates.sortOrder !== undefined)   body.sort_order   = updates.sortOrder;

    const v = await api.patch<ApiVendor>(`/vendors/${id}`, body);
    const updated = apiVendorToFrontend(v);
    queryClient.setQueryData<Vendor[]>(queryKey, (prev) =>
      (prev ?? []).map((x) => (x.id === id ? updated : x)),
    );
  }

  async function deleteVendor(id: string): Promise<void> {
    await api.delete<void>(`/vendors/${id}`);
    queryClient.setQueryData<Vendor[]>(queryKey, (prev) =>
      (prev ?? []).filter((v) => v.id !== id),
    );
  }

  async function toggleFeatured(id: string): Promise<void> {
    const vendor = vendors.find((v) => v.id === id);
    if (!vendor) return;
    await updateVendor(id, { isFeatured: !vendor.isFeatured });
  }

  async function moveVendor(id: string, direction: 'up' | 'down'): Promise<void> {
    const vendor = vendors.find((v) => v.id === id);
    if (!vendor) return;

    const sameCat = vendors
      .filter((v) => v.category === vendor.category)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));

    const pos = sameCat.findIndex((v) => v.id === id);
    const swapPos = direction === 'up' ? pos - 1 : pos + 1;
    if (swapPos < 0 || swapPos >= sameCat.length) return;

    const swapTarget = sameCat[swapPos];
    const myOrder = vendor.sortOrder;
    const theirOrder = swapTarget.sortOrder;

    await Promise.all([
      updateVendor(id, { sortOrder: theirOrder }),
      updateVendor(swapTarget.id, { sortOrder: myOrder }),
    ]);
  }

  return {
    vendors,
    loading: query.isLoading,
    refresh: () => { void query.refetch(); },
    addVendor,
    updateVendor,
    deleteVendor,
    toggleFeatured,
    moveVendor,
  };
}
