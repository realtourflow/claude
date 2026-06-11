/**
 * ARIVE loan-data client. Mirrors backend/internal/arive/client.go.
 *
 * Fetches loan trackers / status / key dates from ARIVE — only for Mountain
 * Mortgage / Fast Pass deals (arive_linked = true; the sync route enforces
 * scope). Auth is OAuth2 client-credentials: POST /api/auth/token with an
 * X-API-KEY header + {ClientId, ClientSecret} → a bearer token cached until
 * expiry; GET /api/loans/{id} carries that bearer + the API key.
 *
 * Test seams:
 * - setAriveForTesting() injects a whole fake client (route-level tests).
 * - DefaultAriveClient also takes an injectable `fetch` so its real token/loan
 *   flow can be unit-tested directly (see lib/arive.test.ts) without hitting
 *   real ARIVE.
 */
import { env } from "./env";

export type AriveLoan = {
  loanId: string;
  status: string;
  milestones: unknown;
  keyDates: unknown;
};

export type AriveClient = {
  enabled(): boolean;
  fetchLoan(loanId: string): Promise<AriveLoan>;
};

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// The subset of ARIVE's "Get Loan Details" response we read.
type AriveLoanResponse = {
  id?: string;
  currentLoanStatus?: { status?: string };
  loanTrackers?: Array<{
    name?: string;
    currentTrackerStatus?: { status?: string };
  }>;
  keyDates?: unknown;
};

let stub: AriveClient | undefined;

export function setAriveForTesting(c: AriveClient | undefined): void {
  stub = c;
}

// 10s cap so a hung (not erroring) ARIVE can't ride a webhook ack or link
// request to the platform timeout — both call sites swallow the rejection.
const defaultFetch: FetchLike = (url, init) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });

export class DefaultAriveClient implements AriveClient {
  private accessToken = "";
  private tokenExpiresAt = 0; // epoch ms

  constructor(private readonly fetchImpl: FetchLike = defaultFetch) {}

  enabled(): boolean {
    const e = env();
    return !!e.ARIVE_API_URL && !!e.ARIVE_API_KEY && !!e.ARIVE_CLIENT_ID;
  }

  async fetchLoan(loanId: string): Promise<AriveLoan> {
    const e = env();
    const token = await this.token();
    const res = await this.fetchImpl(
      `${e.ARIVE_API_URL}/api/loans/${encodeURIComponent(loanId)}`,
      {
        method: "GET",
        headers: {
          "content-type": "application/json",
          "x-api-key": e.ARIVE_API_KEY,
          authorization: `Bearer ${token}`,
        },
      }
    );
    if (!res.ok) {
      // Surface the failure — never silently write a phantom "unknown" status.
      throw new Error(
        `arive get loan ${loanId}: status ${res.status}: ${await safeText(res)}`
      );
    }
    const loan = (await res.json()) as AriveLoanResponse;
    return {
      loanId,
      status: loan.currentLoanStatus?.status ?? "",
      milestones: loan.loanTrackers ?? [],
      keyDates: loan.keyDates ?? null,
    };
  }

  // Returns a cached bearer token, fetching a fresh one when missing/expired.
  private async token(): Promise<string> {
    if (this.accessToken && this.tokenExpiresAt > Date.now()) {
      return this.accessToken;
    }
    const e = env();
    const res = await this.fetchImpl(`${e.ARIVE_API_URL}/api/auth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": e.ARIVE_API_KEY,
      },
      body: JSON.stringify({
        ClientId: e.ARIVE_CLIENT_ID,
        ClientSecret: e.ARIVE_CLIENT_SECRET,
      }),
    });
    if (!res.ok) {
      throw new Error(`arive token: status ${res.status}: ${await safeText(res)}`);
    }
    const data = (await res.json()) as {
      token?: string;
      access_token?: string;
      expires_in?: number;
    };
    const tok = data.token || data.access_token || "";
    if (!tok) {
      throw new Error("arive token response contained no token field");
    }
    // Refresh ~a minute early; default to ~58 min when ARIVE omits expires_in.
    const ttlSec =
      data.expires_in && data.expires_in > 0 ? data.expires_in - 60 : 3500;
    this.accessToken = tok;
    this.tokenExpiresAt = Date.now() + ttlSec * 1000;
    return tok;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

let real: AriveClient | undefined;

export function getAriveClient(): AriveClient {
  if (stub) return stub;
  if (!real) real = new DefaultAriveClient();
  return real;
}
