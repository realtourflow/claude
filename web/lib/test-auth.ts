/**
 * Test-only auth seam for end-to-end (Playwright) runs.
 *
 * In production the API verifies real Auth0 RS256 tokens via a remote JWKS
 * (see `lib/auth.ts`). Driving a real Auth0 browser login from Playwright is
 * brittle and needs secrets CI doesn't have, so for E2E we mint our own RS256
 * tokens and verify them against a local keypair.
 *
 * The keypair is generated once per server process and is shared by both the
 * minting endpoint (`app/api/test-auth/route.ts`) and the verifier
 * (`getE2EVerifyOptions`). Because both live in the same process, the signer
 * and verifier always agree — no key material is committed to the repo.
 *
 * EVERYTHING here is inert unless `e2eAuthEnabled()` returns true: the
 * `E2E_AUTH === "1"` flag is only ever set by Playwright's webServer (see
 * `playwright.config.ts`), and as a backstop the helper hard-disables itself
 * in Vercel production (`VERCEL_ENV === "production"`) even if the flag is
 * mistakenly set there. The token-minting route 404s without it and
 * `getDefaultOpts` only routes here when it is enabled.
 */
import { SignJWT } from "jose";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import type { VerifyOptions } from "./auth";

export const E2E_ISSUER = "https://e2e.realtourflow.local/";
export const E2E_AUDIENCE = "https://api.e2e.realtourflow.local";
const ROLE_CLAIM = "https://realtourflow.com/roles";

/**
 * True only when E2E test-auth has been explicitly enabled for this process
 * AND we are not running in Vercel production. The single source of truth for
 * the seam — `lib/auth.ts` (verifier swap) and `app/api/test-auth/route.ts`
 * (token mint) both gate on this.
 *
 * The `VERCEL_ENV` backstop means a mistakenly-set `E2E_AUTH=1` on Vercel —
 * where dashboard env vars default to ALL environments and preview URLs are
 * publicly reachable — can never open the unauthenticated admin mint.
 * Playwright's webServer runs `next dev` with no `VERCEL_ENV`, so the E2E
 * path keeps working everywhere it is meant to (local + CI only).
 */
export function e2eAuthEnabled(): boolean {
  return process.env.E2E_AUTH === "1" && !process.env.VERCEL_ENV;
}

let keys: { publicKey: KeyObject; privateKey: KeyObject } | undefined;

function getKeys(): { publicKey: KeyObject; privateKey: KeyObject } {
  if (!keys) {
    keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  }
  return keys;
}

/**
 * VerifyOptions backed by the in-process public key. Plugs into the same
 * `verifyToken` / `verifyAuth0Jwt` path real requests use — the only difference
 * is the key source and the issuer/audience.
 */
export function getE2EVerifyOptions(): VerifyOptions {
  const { publicKey } = getKeys();
  return {
    // jose accepts a key-resolver function in place of a JWKS; return our
    // single public key for every token.
    jwks: (async () => publicKey) as unknown as VerifyOptions["jwks"],
    issuer: E2E_ISSUER,
    audience: E2E_AUDIENCE,
  };
}

/**
 * Mints an RS256 JWT shaped like an Auth0 access token: `sub` identifies the
 * user and the roles claim drives role-based access. Verifiable by
 * `getE2EVerifyOptions()`.
 */
export async function signE2EToken(
  sub: string,
  roles: string[]
): Promise<string> {
  const { privateKey } = getKeys();
  return new SignJWT({ sub, [ROLE_CLAIM]: roles })
    .setProtectedHeader({ alg: "RS256", kid: "e2e-key" })
    .setIssuedAt()
    .setIssuer(E2E_ISSUER)
    .setAudience(E2E_AUDIENCE)
    .setExpirationTime("12h")
    .sign(privateKey);
}
