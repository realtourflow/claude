/**
 * SimplyRETS MLS client. Mirrors backend/internal/simplyrets/client.go.
 *
 * Searches listings on the SimplyRETS API (GET /properties) using a *per-agent*
 * MLS key/secret pair (HTTP Basic auth). Credentials are NOT read from env —
 * each agent stores their own key/secret (users.mls_key / users.mls_secret) and
 * they are passed in per call.
 *
 * Test seams (mirroring lib/arive.ts):
 * - setSimplyretsForTesting() injects a whole fake client (route-level tests).
 * - DefaultSimplyRetsClient also takes an injectable `fetch` so its real
 *   Basic-auth search + response mapping can be unit-tested directly without
 *   hitting the real SimplyRETS API.
 */
import type { MLSListing } from "@/hooks/useMLS";

const BASE_URL = "https://api.simplyrets.com";

export type SearchParams = {
  minPrice?: number;
  maxPrice?: number;
  cities?: string[];
  minBeds?: number;
  status?: string;
  limit?: number;
};

export type SimplyRetsClient = {
  /** Search listings using the supplied per-agent MLS credentials. */
  search(
    key: string,
    secret: string,
    params: SearchParams
  ): Promise<MLSListing[]>;
};

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// The subset of the SimplyRETS /properties response we read. Mirrors the Go
// Listing struct's json tags in simplyrets/client.go.
type SimplyRetsListing = {
  mlsId?: number | string;
  listPrice?: number;
  address?: {
    full?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  };
  property?: {
    bedrooms?: number;
    bathsFull?: number;
    area?: number;
    subType?: string;
  };
  photos?: string[];
  mls?: {
    status?: string;
    daysOnMarket?: number;
    mlsId?: number | string;
  };
  remarks?: string;
};

let stub: SimplyRetsClient | undefined;

export function setSimplyretsForTesting(c: SimplyRetsClient | undefined): void {
  stub = c;
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

export class DefaultSimplyRetsClient implements SimplyRetsClient {
  constructor(private readonly fetchImpl: FetchLike = defaultFetch) {}

  async search(
    key: string,
    secret: string,
    params: SearchParams
  ): Promise<MLSListing[]> {
    const q = new URLSearchParams();
    if (params.minPrice && params.minPrice > 0) {
      q.set("minprice", String(params.minPrice));
    }
    if (params.maxPrice && params.maxPrice > 0) {
      q.set("maxprice", String(params.maxPrice));
    }
    for (const city of params.cities ?? []) {
      q.append("cities", city);
    }
    if (params.minBeds && params.minBeds > 0) {
      q.set("minbeds", String(params.minBeds));
    }
    q.set("status", params.status && params.status !== "" ? params.status : "Active");
    const limit = params.limit && params.limit > 0 ? params.limit : 12;
    q.set("limit", String(limit));

    const auth = Buffer.from(`${key}:${secret}`).toString("base64");
    const res = await this.fetchImpl(`${BASE_URL}/properties?${q.toString()}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Basic ${auth}`,
      },
    });

    if (res.status === 401) {
      throw new Error("invalid MLS credentials");
    }
    if (!res.ok) {
      throw new Error(`simplyrets: ${res.status} ${res.statusText}`);
    }

    const raw = (await res.json()) as SimplyRetsListing[];
    return (Array.isArray(raw) ? raw : []).map(mapListing);
  }
}

// Maps a SimplyRETS listing onto the exact MLSListing shape the frontend
// (hooks/useMLS.ts) expects.
function mapListing(l: SimplyRetsListing): MLSListing {
  return {
    mlsId: l.mlsId != null ? String(l.mlsId) : "",
    listPrice: l.listPrice ?? 0,
    address: {
      full: l.address?.full ?? "",
      city: l.address?.city ?? "",
      state: l.address?.state ?? "",
      postalCode: l.address?.postalCode ?? "",
    },
    property: {
      bedrooms: l.property?.bedrooms ?? 0,
      bathsFull: l.property?.bathsFull ?? 0,
      area: l.property?.area ?? 0,
      subType: l.property?.subType ?? "",
    },
    photos: l.photos ?? [],
    mls: {
      status: l.mls?.status ?? "",
      daysOnMarket: l.mls?.daysOnMarket ?? 0,
    },
    remarks: l.remarks ?? "",
  };
}

let real: SimplyRetsClient | undefined;

export function getSimplyretsClient(): SimplyRetsClient {
  if (stub) return stub;
  if (!real) real = new DefaultSimplyRetsClient();
  return real;
}
