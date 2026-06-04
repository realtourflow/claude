import { error } from "@/lib/http";
import { prisma } from "@/lib/db";
import { getGoogleOAuth } from "@/lib/google-oauth";
import {
  verifyOAuthState,
  readStateCookie,
  clearStateCookie,
} from "@/lib/oauth-state";

const PROVIDER = "google_calendar";
const SETTINGS_REDIRECT = "/settings?integration=google_calendar&status=connected";

// OAuth redirect target — Google sends the browser here with ?code & ?state.
// Not under /me and not Bearer-authed: identity travels in the signed, HttpOnly
// state cookie set by `start`. Mirrors the callback half of
// backend/internal/calendar/oauth.go (Exchange + SaveToken).
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const stateParam = url.searchParams.get("state") ?? "";

  // CSRF: the signed cookie must verify and its nonce must match the echoed state.
  const cookie = readStateCookie(req);
  const state = cookie ? await verifyOAuthState(cookie) : null;
  if (!state || !stateParam || state.nonce !== stateParam) {
    return error("invalid oauth state", 400);
  }
  if (!code) {
    return error("missing authorization code", 400);
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
        // Preserve the stored refresh token / email when Google returns none
        // (it omits the refresh token on re-consent) — COALESCE-style.
        ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
        ...(tokens.account_email ? { account_email: tokens.account_email } : {}),
      },
    });
  } catch (err) {
    console.error("google oauth callback failed", err);
    return error("failed to connect google calendar", 502);
  }

  // Send the browser back to Settings, and expire the now-spent state cookie.
  return new Response(null, {
    status: 302,
    headers: {
      location: new URL(SETTINGS_REDIRECT, req.url).toString(),
      "set-cookie": clearStateCookie(),
    },
  });
}
