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
      select: { name: true, phone: true, market: true, markets: true, brokerage: true },
    });
    if (!user) return error("user not found", 401);
    return json({
      ...user,
      markets: Array.isArray(user.markets) ? user.markets : [],
    });
  })) as Response;
}

type PatchBody = {
  name?: string;
  phone?: string | null;
  // Legacy single-market write. Still accepted; superseded by `markets`.
  market?: string;
  // The agent's full market selection (multi-select). Each code is validated
  // against the canonical list; users.market is kept in sync as the FIRST pick
  // (the primary market — board forms, uploads, and recognition key off it).
  markets?: string[];
  // The agent's company. Picked from the managed brokerages list, or typed via
  // "Other" — unknown names are queued (pending) for admin review so Paul can
  // add them to the dropdown for future agents.
  brokerage?: string;
  // complete: false = a MID-onboarding save (e.g. the company & markets step
  // persists early so the forms-upload gate passes). Skips the implicit
  // onboarding_complete flip and the "finished onboarding" admin notification.
  complete?: boolean;
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
    if (body.markets !== undefined) {
      if (!Array.isArray(body.markets) || body.markets.some((m) => typeof m !== "string")) {
        return error("markets must be an array of market codes", 400);
      }
      const bad = body.markets.find((m) => !isValidMarket(m));
      if (bad !== undefined) return error(`invalid market: ${bad}`, 400);
    }

    const finishesOnboarding = body.complete !== false;
    const data: {
      name?: string;
      phone?: string | null;
      market?: string;
      markets?: string[];
      brokerage?: string;
      onboarding_complete?: boolean;
      updated_at: Date;
    } = {
      ...(finishesOnboarding ? { onboarding_complete: true } : {}),
      updated_at: new Date(),
    };
    if (typeof body.name === "string") data.name = body.name;
    if (body.phone !== undefined) data.phone = body.phone;
    if (body.market !== undefined) {
      data.market = body.market;
      // Keep the pair coherent: a legacy single-market write also syncs the
      // markets array (mirrors the migration backfill) so promotion matching
      // never diverges from the primary market.
      data.markets = body.market ? [body.market] : [];
    }
    if (body.markets !== undefined) {
      const markets = [...new Set(body.markets)];
      data.markets = markets;
      // Primary market = first pick; keeps board forms / uploads / recognition working.
      data.market = markets[0] ?? "";
    }

    // Company: trim, then CANONICALIZE to the managed list's exact spelling
    // (case-insensitive match) so promotion matching — byte-exact against the
    // managed name — always hits. Only a genuinely unknown name stays as typed
    // and gets queued for admin review below.
    let unknownBrokerage: string | null = null;
    if (typeof body.brokerage === "string") {
      const typed = body.brokerage.trim();
      if (typed) {
        const known = await prisma.brokerages.findFirst({
          where: { name: { equals: typed, mode: "insensitive" } },
          select: { name: true, status: true },
        });
        if (known) {
          data.brokerage = known.name;
        } else {
          data.brokerage = typed;
          unknownBrokerage = typed;
        }
      } else {
        data.brokerage = "";
      }
    }

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

    // "Other" company queue: an unknown name becomes a PENDING suggestion for the
    // admin to review into the dropdown. Agents only (buyers/sellers PATCH this
    // route too), capped per user so junk can't spam the queue. Best-effort.
    if (unknownBrokerage && before?.role === "agent") {
      try {
        const openSuggestions = await prisma.brokerages.count({
          where: { suggested_by: userId, status: "pending" },
        });
        if (openSuggestions < 3) {
          await prisma.brokerages.create({
            data: { name: unknownBrokerage, status: "pending", suggested_by: userId },
          });
          await sendNotificationEmail({
            to: ADMIN_NOTIFY_EMAIL,
            subject: `New company to review: ${unknownBrokerage}`,
            heading: "An agent entered a company that isn't in the list",
            body: `"${unknownBrokerage}" was entered during profile setup. Review it under Admin → Companies to add it to the dropdown for future agents (or reject it).`,
            dealUrl: `${new URL(req.url).origin}/admin/brokerages`,
          });
        }
      } catch (err) {
        console.error("failed to queue brokerage suggestion", err);
      }
    }

    // Best-effort: notify the admin the first time an AGENT completes onboarding
    // (buyers/sellers also PATCH this on their own onboarding — guard on role),
    // so Paul can welcome them and review their uploaded forms. Never fail the PATCH.
    if (
      finishesOnboarding &&
      before &&
      before.role === "agent" &&
      before.onboarding_complete === false
    ) {
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
