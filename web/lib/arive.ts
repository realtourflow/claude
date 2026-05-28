/**
 * ARIVE loan-data client stub. Mirrors backend/internal/arive/client.go.
 *
 * In the Go backend, the client makes authenticated calls to ARIVE's API to
 * fetch loan trackers/milestones/key dates. Until we re-implement that in
 * TypeScript, this exposes the same surface as a stub — it always reports
 * `enabled = false` unless ARIVE_API_URL is set, and `fetchLoan()` returns
 * an empty shape. Calls flow through but write nothing real to deals.
 *
 * Test seam: setAriveForTesting() lets integration tests inject a fake.
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

let stub: AriveClient | undefined;

export function setAriveForTesting(c: AriveClient | undefined): void {
  stub = c;
}

class DefaultAriveClient implements AriveClient {
  enabled(): boolean {
    return !!env().ARIVE_API_URL;
  }
  async fetchLoan(loanId: string): Promise<AriveLoan> {
    // TODO(phase-7-followup): real ARIVE API call.
    return {
      loanId,
      status: "unknown",
      milestones: null,
      keyDates: null,
    };
  }
}

let real: AriveClient | undefined;

export function getAriveClient(): AriveClient {
  if (stub) return stub;
  if (!real) real = new DefaultAriveClient();
  return real;
}
