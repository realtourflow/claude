import { prisma } from "@/lib/db";
import { getGoogleOAuth } from "@/lib/google-oauth";
import {
  verifyOAuthState,
  readStateCookie,
  settingsRedirect,
} from "@/lib/oauth-state";

const PROVIDER = "google_calendar";

// OAuth redirect target — Google sends the browser here with ?code & ?state.
// Not under /me and not Bearer-authed: identity travels in the signed, HttpOnly
// state cookie set by `start`. Every exit bounces back to the Settings →
// Integrations tab (success or a friendly error), never a raw error page.
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const stateParam = url.searchParams.get("state") ?? "";
  const providerError = url.searchParams.get("error");

  // User denied consent / provider-side error → bounce with the reason.
  if (providerError) {
    return settingsRedirect(req.url, PROVIDER, "error", providerError);
  }

  // CSRF: the signed cookie must verify and its nonce must match the echoed state.
  const cookie = readStateCookie(req);
  const state = cookie ? await verifyOAuthState(cookie) : null;
  if (!state || !stateParam || state.nonce !== stateParam) {
    return settingsRedirect(req.url, PROVIDER, "error", "invalid_state");
  }
  if (!code) {
    return settingsRedirect(req.url, PROVIDER, "error", "missing_code");
  }

  try {
    const tokens = await getGoogleOAuth().exchangeCode(code);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await prisma.oauth_tokens.upsert({
      where: { user_id_provider: { user_id: state.uid, provider: PROVIDER } },
      create: {
        user_id: state.uid,
        provider: PROVIDER,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        scope: tokens.scope,
        account_email: tokens.account_email || null,
        expires_at: expiresAt,
      },
      update: {
        access_token: tokens.access_token,
        scope: tokens.scope,
        expires_at: expiresAt,
        updated_at: new Date(),
        // A fresh successful connect clears any "reconnect needed" flag a prior
        // dead-token refresh may have set (#296).
        needs_reconnect: false,
        // Preserve the stored refresh token / email when Google returns none.
        ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
        ...(tokens.account_email ? { account_email: tokens.account_email } : {}),
      },
    });
  } catch (err) {
    console.error("google oauth callback failed", err);
    return settingsRedirect(req.url, PROVIDER, "error", "exchange_failed");
  }

  return settingsRedirect(req.url, PROVIDER, "connected");
}
