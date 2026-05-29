// TODO(phase-8-followup): real Google OAuth callback.
// - Validate state.
// - Exchange code for access + refresh tokens.
// - Fetch user email via userinfo.
// - Upsert oauth_tokens row (provider='google_calendar').
// - Redirect back to /settings?integration=google_calendar&status=connected.
export async function GET(): Promise<Response> {
  return new Response("not yet implemented", { status: 501 });
}
