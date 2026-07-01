import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { isValidMarket } from "@/lib/markets";
import { sendNotificationEmail } from "@/lib/email";

const ADMIN_NOTIFY_EMAIL = "paul@mountain.mortgage";

// GET /api/me/profile — the caller's editable profile record (the queryable
// users columns, distinct from the user_settings JSON blob).
export async function GET(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { name: true, phone: true, market: true, brokerage: true },
    });
    if (!user) return error("user not found", 401);
    return json(user);
  })) as Response;
}

type PatchBody = {
  name?: string;
  phone?: string | null;
  // Market drives which board contract forms the agent sees. One per agent;
  // "" clears it. Validated against the canonical list.
  market?: string;
  // Free-text brokerage — informational; Paul references it to wire
  // brokerage-specific forms. No automation.
  brokerage?: string;
};

export async function PATCH(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);

    let body: PatchBody;
    try {
      body = (await req.json()) as PatchBody;
    } catch {
      return error("invalid request body", 400);
    }

    if (body.market !== undefined && body.market !== "" && !isValidMarket(body.market)) {
      return error(`invalid market: ${body.market}`, 400);
    }

    const data: {
      name?: string;
      phone?: string | null;
      market?: string;
      brokerage?: string;
      onboarding_complete: boolean;
      updated_at: Date;
    } = {
      onboarding_complete: true,
      updated_at: new Date(),
    };
    if (typeof body.name === "string") data.name = body.name;
    if (body.phone !== undefined) data.phone = body.phone;
    if (body.market !== undefined) data.market = body.market;
    if (typeof body.brokerage === "string") data.brokerage = body.brokerage;

    // Snapshot pre-update state so we can fire a one-time "agent finished
    // onboarding" admin notification only on the FALSE->TRUE transition.
    const before = await prisma.users.findUnique({
      where: { id: userId },
      select: { role: true, onboarding_complete: true, name: true, email: true },
    });

    await prisma.users.update({
      where: { id: userId },
      data,
    });

    // Best-effort: notify the admin the first time an AGENT completes onboarding
    // (buyers/sellers also PATCH this on their own onboarding — guard on role),
    // so Paul can welcome them and review their uploaded forms. Never fail the PATCH.
    if (before && before.role === "agent" && before.onboarding_complete === false) {
      try {
        const origin = new URL(req.url).origin;
        const who = (typeof data.name === "string" && data.name) || before.name || before.email;
        await sendNotificationEmail({
          to: ADMIN_NOTIFY_EMAIL,
          subject: `Agent finished onboarding: ${who}`,
          heading: "An agent completed onboarding",
          body: `${who} (${before.email}) just finished onboarding. Review the forms they uploaded under Admin → Form Review, and reach out to welcome them.`,
          dealUrl: `${origin}/admin/forms`,
        });
      } catch (err) {
        console.error("failed to send agent-onboarding-complete notification", err);
      }
    }

    return json({ ok: true });
  })) as Response;
}
