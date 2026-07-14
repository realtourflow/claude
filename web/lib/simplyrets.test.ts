import { describe, it, expect } from "vitest";
import {
  DefaultSimplyRetsClient,
  SimplyRetsAuthError,
  type FetchLike,
} from "@/lib/simplyrets";

// Exercise the REAL DefaultSimplyRetsClient (the new code) with an injected
// fetch, so the Basic-auth header, query-string building, and response→MLSListing
// mapping are covered directly — the route tests in tests/api/mls.test.ts inject
// a whole fake client and never touch this layer.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "content-type": "application/json" },
  });
}

type Call = { url: string; init?: RequestInit };

const RAW_LISTING = {
  mlsId: 12345,
  listPrice: 525000,
  address: { full: "9 Oak Ln", city: "Dallas", state: "TX", postalCode: "75201" },
  property: { bedrooms: 4, bathsFull: 3, area: 2400, subType: "SingleFamilyResidence" },
  photos: ["https://photos.test/a.jpg", "https://photos.test/b.jpg"],
  mls: { status: "Active", daysOnMarket: 12, mlsId: 12345 },
  remarks: "Great street.",
};

describe("DefaultSimplyRetsClient.search", () => {
  it("sends Basic auth + the expected query string, and maps the response", async () => {
    const calls: Call[] = [];
    const fakeFetch: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse([RAW_LISTING]);
    };

    const client = new DefaultSimplyRetsClient(fakeFetch);
    const listings = await client.search("my-key", "my-secret", {
      minPrice: 300000,
      maxPrice: 700000,
      minBeds: 3,
      cities: ["Dallas", "Plano"],
    });

    // Mapped to the exact MLSListing shape (mlsId stringified).
    expect(listings).toEqual([
      {
        mlsId: "12345",
        listPrice: 525000,
        address: { full: "9 Oak Ln", city: "Dallas", state: "TX", postalCode: "75201" },
        property: { bedrooms: 4, bathsFull: 3, area: 2400, subType: "SingleFamilyResidence" },
        photos: ["https://photos.test/a.jpg", "https://photos.test/b.jpg"],
        mls: { status: "Active", daysOnMarket: 12 },
        remarks: "Great street.",
      },
    ]);

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url.startsWith("https://api.simplyrets.com/properties?")).toBe(true);
    expect(url).toContain("minprice=300000");
    expect(url).toContain("maxprice=700000");
    expect(url).toContain("minbeds=3");
    expect(url).toContain("cities=Dallas");
    expect(url).toContain("cities=Plano");
    // Defaults: Active status + limit 12.
    expect(url).toContain("status=Active");
    expect(url).toContain("limit=12");

    const headers = init?.headers as Record<string, string>;
    const expectedAuth = `Basic ${Buffer.from("my-key:my-secret").toString("base64")}`;
    expect(headers.authorization).toBe(expectedAuth);
    expect(headers.accept).toBe("application/json");
  });

  it("defaults missing fields and handles a non-array response gracefully", async () => {
    const fakeFetch: FetchLike = async () => jsonResponse([{ mlsId: 7 }]);
    const client = new DefaultSimplyRetsClient(fakeFetch);
    const listings = await client.search("k", "s", {});
    expect(listings).toEqual([
      {
        mlsId: "7",
        listPrice: 0,
        address: { full: "", city: "", state: "", postalCode: "" },
        property: { bedrooms: 0, bathsFull: 0, area: 0, subType: "" },
        photos: [],
        mls: { status: "", daysOnMarket: 0 },
        remarks: "",
      },
    ]);
  });

  it("throws a typed SimplyRetsAuthError on 401", async () => {
    const fakeFetch: FetchLike = async () =>
      new Response("unauthorized", { status: 401, statusText: "Unauthorized" });
    const client = new DefaultSimplyRetsClient(fakeFetch);
    // Message preserved for humans...
    await expect(client.search("k", "s", {})).rejects.toThrow(/invalid MLS credentials/);
    // ...and typed so callers can branch on it (issue #309).
    await expect(client.search("k", "s", {})).rejects.toBeInstanceOf(
      SimplyRetsAuthError
    );
  });

  it("throws a generic (non-auth) error on any other non-2xx", async () => {
    const fakeFetch: FetchLike = async () =>
      new Response("boom", { status: 500, statusText: "Internal Server Error" });
    const client = new DefaultSimplyRetsClient(fakeFetch);
    await expect(client.search("k", "s", {})).rejects.toThrow(/simplyrets: 500/);
    // A 5xx is an outage, NOT bad credentials — must not be a SimplyRetsAuthError.
    await expect(client.search("k", "s", {})).rejects.not.toBeInstanceOf(
      SimplyRetsAuthError
    );
  });

  it("honors a custom status + limit", async () => {
    const calls: Call[] = [];
    const fakeFetch: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse([]);
    };
    const client = new DefaultSimplyRetsClient(fakeFetch);
    await client.search("k", "s", { status: "Pending", limit: 25 });
    expect(calls[0].url).toContain("status=Pending");
    expect(calls[0].url).toContain("limit=25");
  });
});
