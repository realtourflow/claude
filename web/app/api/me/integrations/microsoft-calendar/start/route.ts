import { error, json, withAuth } from "@/lib/http";
import { env } from "@/lib/env";
import { resolveUserId } from "@/lib/users";
import { microsoftAuthorizeUrl } from "@/lib/microsoft-oauth";
import { signOAuthState, stateCookie } from "@/lib/oauth-state";

// Starts the Microsoft / Outlook Calendar OAuth connect. Returns the consent
// URL the client should send the agent to, and sets a signed, HttpOnly state
// cookie the callback verifies (CSRF) and reads the initiating user id from.
// Mirrors the Google start route (T2); shares lib/oauth-state.ts.
export async function GET(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    if (!env().MICROSOFT_OAUTH_CLIENT_ID) {
      return error("microsoft calendar OAuth not configured", 501);
    }
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);

    const nonce = crypto.randomUUID();
    const token = await signOAuthState({ uid: userId, nonce });

    const res = json({ authorize_url: await microsoftAuthorizeUrl(nonce) });
    res.headers.set("set-cookie", stateCookie(token));
    return res;
  })) as Response;
}
