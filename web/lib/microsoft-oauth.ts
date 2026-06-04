/**
 * Microsoft / Outlook Calendar OAuth — authorize-URL builder + code/token
 * exchange, via @azure/msal-node (NOT a hand-rolled token POST).
 *
 * Mirrors lib/google-oauth.ts (T2): the network-touching exchange sits behind a
 * test seam (setMicrosoftOAuthForTesting) so integration tests never hit real
 * Microsoft. `microsoftAuthorizeUrl()` is offline — MSAL's getAuthCodeUrl()
 * derives the public-cloud endpoints without a metadata network call.
 *
 * Port reference: backend/internal/calendar/oauth.go (MicrosoftConfig).
 */
import { ConfidentialClientApplication } from "@azure/msal-node";
import { env } from "./env";

// offline_access is what makes Microsoft issue a refresh token.
const SCOPES = ["Calendars.ReadWrite", "offline_access", "User.Read"];

function authority(): string {
  const tenant = env().MICROSOFT_OAUTH_TENANT || "common";
  return `https://login.microsoftonline.com/${tenant}`;
}

function newClient(): ConfidentialClientApplication {
  const e = env();
  // A fresh client per call keeps MSAL's in-memory token cache isolated to one
  // user/exchange (a shared client would accumulate every user's tokens).
  return new ConfidentialClientApplication({
    auth: {
      clientId: e.MICROSOFT_OAUTH_CLIENT_ID,
      clientSecret: e.MICROSOFT_OAUTH_CLIENT_SECRET,
      authority: authority(),
    },
  });
}

/** Builds the consent-screen URL the agent is redirected to. `state` is the CSRF nonce. */
export async function microsoftAuthorizeUrl(state: string): Promise<string> {
  return newClient().getAuthCodeUrl({
    scopes: SCOPES,
    redirectUri: env().MICROSOFT_OAUTH_REDIRECT_URL,
    state,
  });
}

export type MicrosoftTokens = {
  access_token: string;
  /** May be "" — extracted from MSAL's cache; preserved on re-connect if absent. */
  refresh_token: string;
  /** Seconds until the access token expires. */
  expires_in: number;
  scope: string;
  /** The connected Microsoft account's email / UPN. */
  account_email: string;
};

/** The seam: the bit that actually talks to Microsoft. Tests inject a fake. */
export type MicrosoftOAuth = {
  exchangeCode(code: string): Promise<MicrosoftTokens>;
};

let stub: MicrosoftOAuth | undefined;
let real: MicrosoftOAuth | undefined;

/** Test-only: inject a fake exchanger. Pass undefined to restore the real one. */
export function setMicrosoftOAuthForTesting(impl: MicrosoftOAuth | undefined): void {
  stub = impl;
}

class DefaultMicrosoftOAuth implements MicrosoftOAuth {
  async exchangeCode(code: string): Promise<MicrosoftTokens> {
    const client = newClient();
    const result = await client.acquireTokenByCode({
      code,
      scopes: SCOPES,
      redirectUri: env().MICROSOFT_OAUTH_REDIRECT_URL,
    });
    if (!result || !result.accessToken) {
      throw new Error("microsoft token response missing access_token");
    }
    const expiresIn = result.expiresOn
      ? Math.max(0, Math.floor((result.expiresOn.getTime() - Date.now()) / 1000))
      : 3600;
    return {
      access_token: result.accessToken,
      refresh_token: extractRefreshToken(client),
      expires_in: expiresIn,
      scope: (result.scopes ?? []).join(" "),
      account_email: result.account?.username ?? "",
    };
  }
}

// MSAL deliberately doesn't expose the refresh token on the result, so we read
// it back out of the (single-user) serialized token cache. Best-effort: an
// empty result is fine — the callback preserves any previously stored token.
function extractRefreshToken(client: ConfidentialClientApplication): string {
  try {
    const cache = JSON.parse(client.getTokenCache().serialize()) as {
      RefreshToken?: Record<string, { secret?: string }>;
    };
    const entries = cache.RefreshToken ? Object.values(cache.RefreshToken) : [];
    return entries[0]?.secret ?? "";
  } catch {
    return "";
  }
}

export function getMicrosoftOAuth(): MicrosoftOAuth {
  if (stub) return stub;
  if (!real) real = new DefaultMicrosoftOAuth();
  return real;
}
