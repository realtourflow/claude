import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";

type Ctx = { params: Promise<{ id: string }> };

// The editor toggle sends `{ ready: boolean }`: true = share the sheet with the
// seller (status='ready'), false = "Revert to Draft" / unshare (status='draft').
type ReadyBody = { ready?: boolean };

// POST — share or unshare the net sheet with the deal's participants (#258).
// Participants only see the sheet at status='ready' (see the GET route), so
// flipping back to 'draft' re-hides it. Absent/invalid body defaults to
// marking ready, for backward compat with older clients that sent no body.
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    const owned = await prisma.deals.findFirst({
      where: { id: dealId, agent_id: userId },
      select: { id: true },
    });
    if (!owned) return error("deal not found", 404);

    let ready = true;
    try {
      const body = (await req.json()) as ReadyBody;
      if (typeof body?.ready === "boolean") ready = body.ready;
    } catch {
      // No/invalid JSON body — keep the back-compat default (ready = true).
    }

    // Only update an existing sheet; a missing row is a 404, not a P2025 → 500.
    const existing = await prisma.net_sheets.findUnique({
      where: { deal_id: dealId },
      select: { id: true },
    });
    if (!existing) return error("net sheet not found", 404);

    const row = await prisma.net_sheets.update({
      where: { deal_id: dealId },
      data: ready
        ? { status: "ready", ready_at: new Date() }
        : { status: "draft", ready_at: null },
    });
    return json(row);
  })) as Response;
}
