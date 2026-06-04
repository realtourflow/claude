import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DefaultAriveClient, type FetchLike } from "@/lib/arive";

// Exercise the REAL DefaultAriveClient (the new code) with an injected fetch,
// so the client-credentials token flow + GetLoan mapping are covered directly —
// the route tests in tests/api/stripe-arive.test.ts inject a whole fake client
// and never touch this layer.

const ENV_KEYS = [
  "ARIVE_API_URL",
  "ARIVE_API_KEY",
  "ARIVE_CLIENT_ID",
  "ARIVE_CLIENT_SECRET",
] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.ARIVE_API_URL = "https://arive.test";
  process.env.ARIVE_API_KEY = "test-api-key";
  process.env.ARIVE_CLIENT_ID = "test-client-id";
  process.env.ARIVE_CLIENT_SECRET = "test-client-secret";
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Call = { url: string; init?: RequestInit };

const LOAN_BODY = {
  id: "loan-1",
  currentLoanStatus: { status: "In Processing" },
  loanTrackers: [
    { name: "Appraisal", currentTrackerStatus: { status: "Ordered" } },
    { name: "Underwriting", currentTrackerStatus: { status: "Pending" } },
  ],
  keyDates: { estimatedFundingDate: "2026-07-01", closingContingency: "2026-06-25" },
};

describe("DefaultAriveClient.fetchLoan", () => {
  it("authenticates via client-credentials then maps the loan response", async () => {
    const calls: Call[] = [];
    const fakeFetch: FetchLike = async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/api/auth/token")) {
        return jsonResponse({ token: "tok-123", expires_in: 3600 });
      }
      if (url.includes("/api/loans/")) return jsonResponse(LOAN_BODY);
      throw new Error(`unexpected url ${url}`);
    };

    const client = new DefaultAriveClient(fakeFetch);
    const loan = await client.fetchLoan("loan-1");

    expect(loan.loanId).toBe("loan-1");
    expect(loan.status).toBe("In Processing");
    expect(loan.milestones).toEqual(LOAN_BODY.loanTrackers);
    expect(loan.keyDates).toEqual(LOAN_BODY.keyDates);

    const tokenCall = calls.find((c) => c.url.endsWith("/api/auth/token"));
    expect(tokenCall?.url).toBe("https://arive.test/api/auth/token");
    const tokenHeaders = tokenCall?.init?.headers as Record<string, string>;
    expect(tokenHeaders["x-api-key"]).toBe("test-api-key");
    expect(JSON.parse(tokenCall?.init?.body as string)).toEqual({
      ClientId: "test-client-id",
      ClientSecret: "test-client-secret",
    });

    const loanCall = calls.find((c) => c.url.includes("/api/loans/"));
    expect(loanCall?.url).toBe("https://arive.test/api/loans/loan-1");
    const loanHeaders = loanCall?.init?.headers as Record<string, string>;
    expect(loanHeaders.authorization).toBe("Bearer tok-123");
    expect(loanHeaders["x-api-key"]).toBe("test-api-key");
  });

  it("throws on a non-2xx loan response (never a silent 'unknown')", async () => {
    const fakeFetch: FetchLike = async (url) => {
      if (url.endsWith("/api/auth/token")) return jsonResponse({ token: "tok" });
      return new Response("not found", { status: 404 });
    };
    const client = new DefaultAriveClient(fakeFetch);
    await expect(client.fetchLoan("missing")).rejects.toThrow(/404/);
  });

  it("throws when the token endpoint fails", async () => {
    const fakeFetch: FetchLike = async () => new Response("nope", { status: 401 });
    const client = new DefaultAriveClient(fakeFetch);
    await expect(client.fetchLoan("loan-1")).rejects.toThrow(/401/);
  });

  it("caches the bearer token across loan fetches", async () => {
    let tokenCalls = 0;
    const fakeFetch: FetchLike = async (url) => {
      if (url.endsWith("/api/auth/token")) {
        tokenCalls += 1;
        return jsonResponse({ token: "tok", expires_in: 3600 });
      }
      return jsonResponse({ currentLoanStatus: { status: "X" }, loanTrackers: [], keyDates: {} });
    };
    const client = new DefaultAriveClient(fakeFetch);
    await client.fetchLoan("a");
    await client.fetchLoan("b");
    expect(tokenCalls).toBe(1);
  });
});

describe("DefaultAriveClient.enabled", () => {
  it("is true when URL + key + client id are configured", () => {
    expect(new DefaultAriveClient().enabled()).toBe(true);
  });
});
