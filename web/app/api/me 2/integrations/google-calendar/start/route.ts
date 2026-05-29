import { error, withAuth, json } from "@/lib/http";

// TODO(phase-8-followup): real Google OAuth flow.
// - Generate CSRF state, persist to short-lived cache (pg-boss or DB).
// - Build authorize URL with scopes: calendar.events, userinfo.email, openid.
// - Return { authorize_url, state }.
export async function GET(req: Request): Promise<Response> {
  return (await withAuth(req, async (): Promise<Response> => {
    void json;
    return error("google calendar OAuth not yet implemented", 501);
  })) as Response;
}
