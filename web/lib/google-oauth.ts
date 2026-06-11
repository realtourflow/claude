/**
 * Google Calendar OAuth — authorize-URL builder + code/token exchange.
 *
 * Mirrors the legacy Go backend (GoogleConfig / AuthCodeURL /
 * Exchange + userinfo). The network-touching exchange sits behind a test seam
 * (setGoogleOAuthForTesting) exactly like lib/stripe.ts and lib/arive.ts, so
 * integration tests never hit real Google.
 */
import { env } from "./env";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

/**
 * Builds the consent-screen URL the agent is redirected to. `state` is the CSRF
 * nonce. access_type=offline + prompt=consent force Google to return a refresh
 * token even on re-consent (it only sends one on first grant otherwise).
 */
export function googleAuthorizeUrl(state: string): string {
  const e = env();
  const q = new URLSearchParams({
    client_id: e.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: e.GOOGLE_OAUTH_REDIRECT_URL,
    response_type: "code",
    scope: SCOPES.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `${AUTH_URL}?${q.toString()}`;
}

export type GoogleTokens = {
  access_token: string;
  /** May be "" — Google omits it on re-consent without prompt=consent. */
  refresh_token: string;
  /** Seconds until the access token expires. */
  expires_in: number;
  scope: string;
  /** The connected Google account's email (from userinfo). */
  account_email: string;
};

/** The seam: the bit that actually talks to Google. Tests inject a fake. */
export type GoogleOAuth = {
  exchangeCode(code: string): Promise<GoogleTokens>;
};

let stub: GoogleOAuth | undefined;
let real: GoogleOAuth | undefined;

/** Test-only: inject a fake exchanger. Pass undefined to restore the real one. */
export function setGoogleOAuthForTesting(impl: GoogleOAuth | undefined): void {
  stub = impl;
}

class DefaultGoogleOAuth implements GoogleOAuth {
  async exchangeCode(code: string): Promise<GoogleTokens> {
    const e = env();
    const form = new URLSearchParams({
      client_id: e.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: e.GOOGLE_OAUTH_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: e.GOOGLE_OAUTH_REDIRECT_URL,
    });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: form.toString(),
    });
    if (!res.ok) {
      throw new Error(
        `google token endpoint returned ${res.status}: ${await res.text()}`
      );
    }
    const raw = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!raw.access_token) {
      throw new Error("google token response missing access_token");
    }
    return {
      access_token: raw.access_token,
      refresh_token: raw.refresh_token ?? "",
      expires_in: raw.expires_in ?? 3600,
      scope: raw.scope ?? "",
      account_email: await fetchAccountEmail(raw.access_token),
    };
  }
}

async function fetchAccountEmail(accessToken: string): Promise<string> {
  const res = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return "";
  const data = (await res.json()) as { email?: string };
  return data.email ?? "";
}

export function getGoogleOAuth(): GoogleOAuth {
  if (stub) return stub;
  if (!real) real = new DefaultGoogleOAuth();
  return real;
}
