/**
 * Stateless CSRF protection for the calendar OAuth connect flows (Google
 * Calendar today — T2; Microsoft/Outlook reuses this — T3). No DB row needed.
 *
 * `start` mints a random nonce, signs a short-lived token binding that nonce to
 * the initiating user, and drops it in an HttpOnly cookie. The raw nonce is what
 * we hand the provider as the `state` query param. On `callback` we re-read the
 * signed cookie, verify it, and require its embedded nonce to equal the `state`
 * the provider echoed back — a signed double-submit.
 *
 * The user id rides inside the signed cookie (never in the URL), so the
 * unauthenticated callback knows which account to attach the tokens to.
 *
 * Mirrors the `state` handling around backend/internal/calendar/oauth.go.
 */
import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";

export const OAUTH_STATE_COOKIE = "rtf_oauth_state";

// Cookie + token lifetime. The consent round-trip takes seconds; 10 min is slack.
const MAX_AGE_SECONDS = 600;
const ALG = "HS256";

export type OAuthState = {
  /** DB user id (uuid) of the agent who started the connect. */
  uid: string;
  /** Random per-attempt nonce, echoed back by the provider as `state`. */
  nonce: string;
};

function key(): Uint8Array {
  return new TextEncoder().encode(env().OAUTH_STATE_SECRET);
}

/** Signs the state payload into a compact token suitable for the cookie. */
export async function signOAuthState(state: OAuthState): Promise<string> {
  return new SignJWT({ uid: state.uid, nonce: state.nonce })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(key());
}

/**
 * Verifies a signed state token. Returns the payload, or null if the signature
 * is bad, the token expired, or required fields are missing.
 */
export async function verifyOAuthState(token: string): Promise<OAuthState | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: [ALG] });
    const uid = typeof payload.uid === "string" ? payload.uid : "";
    const nonce = typeof payload.nonce === "string" ? payload.nonce : "";
    if (!uid || !nonce) return null;
    return { uid, nonce };
  } catch {
    return null;
  }
}

/** Builds the `Set-Cookie` value carrying the signed state token. */
export function stateCookie(token: string): string {
  return `${OAUTH_STATE_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`;
}

/** Builds a `Set-Cookie` value that immediately clears the state cookie. */
export function clearStateCookie(): string {
  return `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Reads the raw signed state token from a request's `Cookie` header. */
export function readStateCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === OAUTH_STATE_COOKIE) {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}
