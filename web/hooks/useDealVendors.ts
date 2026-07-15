"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { apiVendorToFrontend, type ApiVendor, type Vendor } from "@/hooks/useVendors";

/**
 * Read-only list of a deal's owning-agent vendors, for the buyer/seller client
 * portals. Hits GET /api/deals/:id/vendors (deal-access-checked) so a
 * participant sees the AGENT's Preferred Vendors — not their own (empty) list,
 * which is what useVendors() would return (#265).
 *
 * useVendors() stays the agent's own settings CRUD; this is intentionally a
 * separate, minimal read hook.
 */
export function useDealVendors(dealId: string): {
  vendors: Vendor[];
  loading: boolean;
} {
  const query = useQuery({
    queryKey: ["deal-vendors", dealId],
    queryFn: async () => {
      const data = await api.get<ApiVendor[]>(`/deals/${dealId}/vendors`);
      return data.map(apiVendorToFrontend);
    },
    enabled: !!dealId,
  });

  return {
    vendors: query.data ?? [],
    loading: query.isLoading,
  };
}
