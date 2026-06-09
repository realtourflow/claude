import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/roles";

type Ctx = { params: Promise<{ id: string }> };

// POST /deals/:dealId/fastpass/collect — admin only.
// Marks a deferred (at_closing or seller_concession) Fast Pass as collected.
// Ports backend CollectFastPass (backend/internal/handlers/enrollment.go).
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    if (!hasRole(claims.roles, ["admin"])) return error("forbidden", 403);

    const count = await prisma.$executeRaw`
      UPDATE deals
      SET fast_pass = jsonb_set(
        jsonb_set(fast_pass, '{status}', '"collected"'),
        '{collected_at}', to_jsonb(NOW()::text)
      )
      WHERE id = ${dealId}::uuid
        AND fast_pass IS NOT NULL
        AND fast_pass->>'status' = 'active'
        AND fast_pass->>'payment_option' IN ('at_closing', 'seller_concession')
    `;
    if (count === 0) {
      return error("deal not found or not eligible for collection", 404);
    }
    return json({ ok: true });
  })) as Response;
}
