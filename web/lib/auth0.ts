/**
 * Auth0 client — wraps BOTH halves of FF2 (#20):
 *
 * 1. Public change-password: POST https://{AUTH0_DOMAIN}/dbconnections/change_password
 *    with { client_id, email, connection } — no secret, uses the SPA's public
 *    client id. Auth0 sends its hosted password-reset email and (by design)
 *    responds 200-ish whether or not the user exists; our route additionally
 *    never surfaces failures to the caller.
 *
 * 2. Management API (M2M credentials, scopes read:users + update:users):
 *    - client-credentials token: POST /oauth/token with
 *      { grant_type, client_id, client_secret, audience: https://{domain}/api/v2/ },
 *      cached in-module until expiry (mirrors lib/arive.ts token caching).
 *    - getUser(id):      GET  /api/v2/users/{id}        → { email_verified }
 *    - sendVerificationEmail(id): POST /api/v2/jobs/verification-email
 *      with { user_id, client_id }.
 *
 * Test seams (mirroring lib/arive.ts / lib/simplyrets.ts):
 * - setAuth0ForTesting() injects a whole fake client (route-level tests).
 * - DefaultAuth0Client also takes an injectable `fetch` so the real
 *   change-password / token / Management flows can be unit-tested directly
 *   (see lib/auth0.test.ts) without hitting real Auth0.
 */
import { env } from "./env";

export type Auth0User = {
  email_verified: boolean;
};

export type Auth0Client = {
  /** True when the Management API M2M credentials are configured. */
  managementEnabled(): boolean;
  /** Public change-password flow — triggers Auth0's hosted reset email. */
  sendPasswordResetEmail(email: string): Promise<void>;
  /** Management API: read a user's verification state. Needs read:users. */
  getUser(auth0UserId: string): Promise<Auth0User>;
  /** Management API: queue a verification email job. Needs update:users. */
  sendVerificationEmail(auth0UserId: string): Promise<void>;
};

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

let stub: Auth0Client | undefined;

export function setAuth0ForTesting(c: Auth0Client | undefined): void {
  stub = c;
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

export class DefaultAuth0Client implements Auth0Client {
  private accessToken = "";
  private tokenExpiresAt = 0; // epoch ms

  constructor(private readonly fetchImpl: FetchLike = defaultFetch) {}

  managementEnabled(): boolean {
    const e = env();
    return !!e.AUTH0_DOMAIN && !!e.AUTH0_MGMT_CLIENT_ID && !!e.AUTH0_MGMT_CLIENT_SECRET;
  }

  async sendPasswordResetEmail(email: string): Promise<void> {
    const e = env();
    if (!e.NEXT_PUBLIC_AUTH0_CLIENT_ID) {
      // The route swallows this — log-only failure, never the caller's problem.
      throw new Error("auth0 change_password: NEXT_PUBLIC_AUTH0_CLIENT_ID is not configured");
    }
    const res = await this.fetchImpl(
      `https://${e.AUTH0_DOMAIN}/dbconnections/change_password`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: e.NEXT_PUBLIC_AUTH0_CLIENT_ID,
          email,
          connection: e.AUTH0_DB_CONNECTION,
        }),
      }
    );
    if (!res.ok) {
      throw new Error(
        `auth0 change_password: status ${res.status}: ${await safeText(res)}`
      );
    }
  }

  async getUser(auth0UserId: string): Promise<Auth0User> {
    const e = env();
    const token = await this.token();
    const res = await this.fetchImpl(
      `https://${e.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(auth0UserId)}`,
      {
        method: "GET",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
      }
    );
    if (!res.ok) {
      throw new Error(
        `auth0 get user ${auth0UserId}: status ${res.status}: ${await safeText(res)}`
      );
    }
    const user = (await res.json()) as { email_verified?: boolean };
    return { email_verified: user.email_verified === true };
  }

  async sendVerificationEmail(auth0UserId: string): Promise<void> {
    const e = env();
    const token = await this.token();
    // client_id ties the verification link to this app's settings (redirect,
    // branding). Omitted when the SPA client id is not configured.
    const body: { user_id: string; client_id?: string } = { user_id: auth0UserId };
    if (e.NEXT_PUBLIC_AUTH0_CLIENT_ID) {
      body.client_id = e.NEXT_PUBLIC_AUTH0_CLIENT_ID;
    }
    const res = await this.fetchImpl(
      `https://${e.AUTH0_DOMAIN}/api/v2/jobs/verification-email`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) {
      throw new Error(
        `auth0 verification-email job: status ${res.status}: ${await safeText(res)}`
      );
    }
  }

  // Returns a cached Management API bearer token, fetching a fresh one when
  // missing/expired. Mirrors DefaultAriveClient.token().
  private async token(): Promise<string> {
    if (this.accessToken && this.tokenExpiresAt > Date.now()) {
      return this.accessToken;
    }
    const e = env();
    const res = await this.fetchImpl(`https://${e.AUTH0_DOMAIN}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: e.AUTH0_MGMT_CLIENT_ID,
        client_secret: e.AUTH0_MGMT_CLIENT_SECRET,
        audience: `https://${e.AUTH0_DOMAIN}/api/v2/`,
      }),
    });
    if (!res.ok) {
      throw new Error(`auth0 mgmt token: status ${res.status}: ${await safeText(res)}`);
    }
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    const tok = data.access_token ?? "";
    if (!tok) {
      throw new Error("auth0 mgmt token response contained no access_token field");
    }
    // Refresh ~a minute early; Auth0 M2M tokens default to 24h.
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

let real: Auth0Client | undefined;

export function getAuth0Client(): Auth0Client {
  if (stub) return stub;
  if (!real) real = new DefaultAuth0Client();
  return real;
}
