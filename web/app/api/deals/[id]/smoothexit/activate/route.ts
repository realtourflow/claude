import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { logAudit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

// POST /deals/:dealId/smoothexit/activate — admin only (#303).
//
// The admin-override path for a Smooth Exit enrollment sitting in `pending`.
// Flips status `pending` → `active` and records WHO activated it and WHEN.
// Mirrors the Fast Pass mark-paid route (same admin-gated, audited, race-safe
// conditional-UPDATE shape).
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(
    req,
    async (claims): Promise<Response> => {
      const actorId = await resolveUserId(claims.sub);

      // Existence first → 404; an ineligible (non-pending) enrollment 409s below.
      const deal = await prisma.deals.findUnique({
        where: { id: dealId },
        select: { id: true },
      });
      if (!deal) return error("deal not found", 404);

      // Status guard in the WHERE so a concurrent write can't be overwritten;
      // only a `pending` enrollment is activated.
      const count = await prisma.$executeRaw`
        UPDATE deals
        SET smooth_exit = smooth_exit || jsonb_build_object(
              'status', 'active',
              'activated_by', ${actorId}::text,
              'activated_at', NOW()::text
            ),
            updated_at = NOW()
        WHERE id = ${dealId}::uuid
          AND smooth_exit IS NOT NULL
          AND smooth_exit->>'status' = 'pending'
      `;
      if (count === 0) {
        return error(
          "smooth exit is not pending activation (already active or no enrollment)",
          409
        );
      }

      await logAudit({
        actorId: actorId ?? undefined,
        eventType: "smoothexit_activate",
        dealId,
      });
      return json({ ok: true, status: "active" });
    },
    { allowedRoles: ["admin"] }
  )) as Response;
}
