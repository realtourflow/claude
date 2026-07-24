"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api-client";
import type { PhotoAnalysis } from "@/hooks/useProperties";

/**
 * Property AI insights, agent-facing (#376). Both endpoints are owning-agent-
 * only and cost money per call, so they are ON-DEMAND mutations (mirroring
 * useMLSListings) — never auto-fetched on render.
 */

export type CompCandidate = {
  mlsId: string;
  address: string;
  city: string;
  postalCode: string;
  closePrice: number;
  closeDate: string;
  beds: number;
  baths: number;
  sqft: number;
};

/** GET /deals/:id/properties/:propId/comps response (see comps route). */
export type CompsResponse = {
  range: { low: number; high: number } | null;
  basis: "price_per_sqft" | "close_price" | null;
  median_price_per_sqft: number | null;
  comps: CompCandidate[];
  comp_count: number;
  max_comps: number;
  tier_used: string | null;
  widened: boolean;
  outliers_removed: number;
  reason: "no_comps" | "insufficient_comps" | null;
  disclaimer: string;
};

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    // 503 = the deal agent hasn't connected MLS; 502 = SimplyRETS outage /
    // model failure. Give the agent a next step for the connect case.
    if (e.status === 503) return "Connect MLS in Settings to pull comps.";
    if (e.status === 422) return "This property has no city to search comps in.";
    return e.message || "Something went wrong.";
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}

/** On-demand comp analysis for a tracked property. */
export function usePropertyComps(dealId: string | undefined, propId: string) {
  const mutation = useMutation({
    mutationFn: async () => {
      if (!dealId) throw new Error("no deal");
      return api.get<CompsResponse>(
        `/deals/${dealId}/properties/${propId}/comps`
      );
    },
  });
  return {
    run: () => mutation.mutate(),
    data: mutation.data ?? null,
    loading: mutation.isPending,
    error: mutation.error ? errorMessage(mutation.error) : "",
    ran: mutation.isSuccess,
  };
}

/**
 * On-demand photo analysis. `photoUrls` defaults to the property thumbnail
 * server-side when omitted. On success we invalidate the property list so the
 * freshly-stored `photo_analysis` re-renders on the card.
 */
export function useAnalyzePhotos(dealId: string | undefined, propId: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (photoUrls?: string[]) => {
      if (!dealId) throw new Error("no deal");
      const body = photoUrls && photoUrls.length > 0 ? { photo_urls: photoUrls } : {};
      return api.post<{ analysis: PhotoAnalysis }>(
        `/deals/${dealId}/properties/${propId}/analyze-photos`,
        body
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["properties", dealId ?? ""] });
    },
  });
  return {
    run: (photoUrls?: string[]) => mutation.mutate(photoUrls),
    data: mutation.data?.analysis ?? null,
    loading: mutation.isPending,
    error: mutation.error ? errorMessage(mutation.error) : "",
  };
}
