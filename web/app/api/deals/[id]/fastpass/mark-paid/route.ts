import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { logAudit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

// POST /deals/:dealId/fastpass/mark-paid — admin only (#303).
//
// The admin-override path for a Fast Pass enrollment stuck in `pending_payment`
// (the out-of-band / manual case — the happy path collects via Stripe). Flips
// status `pending_payment` → `active` and stamps the enrollment as paid,
// recording WHO marked it and WHEN so the action is traceable. Mirrors the
// sibling admin action route (fastpass/collect) plus the fee/waive audit shape.
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(
    req,
    async (claims): Promise<Response> => {
      const actorId = await resolveUserId(claims.sub);

      // Existence first so a missing deal stays 404 (vs the 409 an ineligible
      // enrollment gets below).
      const deal = await prisma.deals.findUnique({
        where: { id: dealId },
        select: { id: true },
      });
      if (!deal) return error("deal not found", 404);

      // The status guard lives in the UPDATE's WHERE so a concurrent Stripe
      // webhook can't be raced: only a `pending_payment` enrollment is touched.
      // `||` shallow-merges the new keys onto the existing JSONB (status → active,
      // paid → true) and records the admin actor + timestamp.
      const count = await prisma.$executeRaw`
        UPDATE deals
        SET fast_pass = fast_pass || jsonb_build_object(
              'status', 'active',
              'paid', true,
              'paid_at', NOW()::text,
              'marked_paid_by', ${actorId}::text,
              'marked_paid_at', NOW()::text
            ),
            updated_at = NOW()
        WHERE id = ${dealId}::uuid
          AND fast_pass IS NOT NULL
          AND fast_pass->>'status' = 'pending_payment'
      `;
      if (count === 0) {
        return error(
          "fast pass is not awaiting payment (already paid or no enrollment)",
          409
        );
      }

      // Awaited so the audit row commits before we respond; logAudit never
      // throws, so an audit failure can't fail the mutation (best-effort).
      await logAudit({
        actorId: actorId ?? undefined,
        eventType: "fastpass_mark_paid",
        dealId,
      });
      return json({ ok: true, status: "active" });
    },
    { allowedRoles: ["admin"] }
  )) as Response;
}
