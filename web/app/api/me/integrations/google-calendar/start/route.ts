import { error, json, withAuth } from "@/lib/http";
import { env } from "@/lib/env";
import { resolveUserId } from "@/lib/users";
import { googleAuthorizeUrl } from "@/lib/google-oauth";
import { signOAuthState, stateCookie } from "@/lib/oauth-state";

// Starts the Google Calendar OAuth connect. Returns the consent-screen URL the
// client should send the agent to, and sets a signed, HttpOnly state cookie the
// callback verifies (CSRF) and reads the initiating user id back from.
export async function GET(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    if (!env().GOOGLE_OAUTH_CLIENT_ID) {
      return error("google calendar OAuth not configured", 501);
    }
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);

    const nonce = crypto.randomUUID();
    const token = await signOAuthState({ uid: userId, nonce });

    const res = json({ authorize_url: googleAuthorizeUrl(nonce) });
    res.headers.set("set-cookie", stateCookie(token));
    return res;
  })) as Response;
}
