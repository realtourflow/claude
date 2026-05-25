import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { env } from "@/lib/env";

type Status = {
  configured: boolean;
  connected: boolean;
  scope: "platform" | "user";
  account_email?: string;
};

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
      },
      microsoft_calendar: {
        configured: !!e.MICROSOFT_OAUTH_CLIENT_ID,
        connected: false,
        scope: "user",
      },
    };

    const googleTok = await prisma.oauth_tokens.findFirst({
      where: { user_id: userId, provider: "google_calendar" },
      select: { account_email: true },
    });
    if (googleTok) {
      resp.google_calendar.connected = true;
      resp.google_calendar.account_email = googleTok.account_email ?? undefined;
    }
    const msTok = await prisma.oauth_tokens.findFirst({
      where: { user_id: userId, provider: "microsoft_calendar" },
      select: { account_email: true },
    });
    if (msTok) {
      resp.microsoft_calendar.connected = true;
      resp.microsoft_calendar.account_email = msTok.account_email ?? undefined;
    }
    return json(resp);
  })) as Response;
}
