import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { logAudit } from "@/lib/audit";
import { emailDisclosureReminder } from "@/lib/notification-email";

type Ctx = { params: Promise<{ id: string }> };

// POST /deals/:dealId/disclosure-reminder — admin only (#303).
//
// Backs the "Send Reminder" button on the admin Pending Disclosures list:
// nudges the deal's client(s) to sign disclosures that were sent but not yet
// signed. The email is best-effort (mirrors every other notification path —
// a throw must never fail the admin's action); the audit row is the durable
// record that a reminder was sent.
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(
    req,
    async (claims): Promise<Response> => {
      const deal = await prisma.deals.findUnique({
        where: { id: dealId },
        select: { id: true },
      });
      if (!deal) return error("deal not found", 404);

      const actorId = await resolveUserId(claims.sub);

      // Best-effort — a Resend failure must not fail the action.
      try {
        await emailDisclosureReminder({ req, dealId });
      } catch (err) {
        console.error("disclosure reminder email failed", err);
      }

      await logAudit({
        actorId: actorId ?? undefined,
        eventType: "disclosure_reminder",
        dealId,
      });
      return json({ ok: true });
    },
    { allowedRoles: ["admin"] }
  )) as Response;
}
