import { error } from "@/lib/http";
import { prisma } from "@/lib/db";
import { getMicrosoftOAuth } from "@/lib/microsoft-oauth";
import {
  verifyOAuthState,
  readStateCookie,
  clearStateCookie,
} from "@/lib/oauth-state";

const PROVIDER = "microsoft_calendar";
const SETTINGS_REDIRECT =
  "/settings?integration=microsoft_calendar&status=connected";

// OAuth redirect target — Microsoft sends the browser here with ?code & ?state.
// Not under /me and not Bearer-authed: identity travels in the signed, HttpOnly
// state cookie set by `start`. Mirrors the Google callback (T2); shares
// lib/oauth-state.ts. Token exchange goes through @azure/msal-node.
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
    const tokens = await getMicrosoftOAuth().exchangeCode(code);
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
        // Preserve the stored refresh token / email when Microsoft returns none
        // (COALESCE-style) — e.g. a re-consent that doesn't reissue them.
        ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
        ...(tokens.account_email ? { account_email: tokens.account_email } : {}),
      },
    });
  } catch (err) {
    console.error("microsoft oauth callback failed", err);
    return error("failed to connect microsoft calendar", 502);
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
