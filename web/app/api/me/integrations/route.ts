import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { env } from "@/lib/env";

type Status = {
  configured: boolean;
  connected: boolean;
  scope: "platform" | "user";
  account_email?: string;
  /**
   * True when a connected calendar's OAuth token can no longer sync — its
   * refresh path is dead (revoked / no refresh token). The UI shows a
   * "Reconnect" CTA instead of a green "Connected" badge. Only meaningful for
   * the per-user calendar providers (#296).
   */
  needs_reconnect?: boolean;
};

/**
 * A connected calendar needs reconnecting when a background push already flagged
 * it (needs_reconnect) OR when the token is definitively dead on its face —
 * expired with no refresh token to renew it — even if no push has run yet.
 */
function tokenNeedsReconnect(t: {
  needs_reconnect: boolean;
  expires_at: Date;
  refresh_token: string | null;
}): boolean {
  if (t.needs_reconnect) return true;
  return t.expires_at.getTime() < Date.now() && !t.refresh_token;
}

type Response_ = {
  arive: Status;
  docusign: Status;
  stripe: Status;
  google_calendar: Status;
  microsoft_calendar: Status;
};

export async function GET(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);
    const e = env();

    const resp: Response_ = {
      arive: {
        configured: !!e.ARIVE_API_URL,
        connected: !!e.ARIVE_API_URL,
        scope: "platform",
      },
      docusign: {
        configured: !!e.DOCUSIGN_INTEGRATION_KEY,
        connected: !!e.DOCUSIGN_INTEGRATION_KEY,
        scope: "platform",
      },
      stripe: {
        configured: !!e.STRIPE_SECRET_KEY,
        connected: !!e.STRIPE_SECRET_KEY,
        scope: "platform",
      },
      google_calendar: {
        configured: !!e.GOOGLE_OAUTH_CLIENT_ID,
        connected: false,
        scope: "user",
        needs_reconnect: false,
      },
      microsoft_calendar: {
        configured: !!e.MICROSOFT_OAUTH_CLIENT_ID,
        connected: false,
        scope: "user",
        needs_reconnect: false,
      },
    };

    const tokenSelect = {
      account_email: true,
      needs_reconnect: true,
      expires_at: true,
      refresh_token: true,
    } as const;

    const googleTok = await prisma.oauth_tokens.findFirst({
      where: { user_id: userId, provider: "google_calendar" },
      select: tokenSelect,
    });
    if (googleTok) {
      resp.google_calendar.connected = true;
      resp.google_calendar.account_email = googleTok.account_email ?? undefined;
      resp.google_calendar.needs_reconnect = tokenNeedsReconnect(googleTok);
    }
    const msTok = await prisma.oauth_tokens.findFirst({
      where: { user_id: userId, provider: "microsoft_calendar" },
      select: tokenSelect,
    });
    if (msTok) {
      resp.microsoft_calendar.connected = true;
      resp.microsoft_calendar.account_email = msTok.account_email ?? undefined;
      resp.microsoft_calendar.needs_reconnect = tokenNeedsReconnect(msTok);
    }
    return json(resp);
  })) as Response;
}
