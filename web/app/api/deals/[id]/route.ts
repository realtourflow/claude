import { Prisma } from "@/app/generated/prisma/client";
import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { canReadDeal, getDealById } from "@/lib/deals";
import { logAudit } from "@/lib/audit";
import { dealPatchBodySchema } from "@/lib/schemas/deal";
import { parseBody } from "@/lib/schemas/parse";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    // Read access (#167): owning agent, deal participant, the agent's linked
    // TC (users.tc_user_id), or admin. 404 (not 403) so strangers can't probe
    // which deal ids exist.
    if (!(await canReadDeal(id, userId, claims.roles))) {
      return error("deal not found", 404);
    }
    const deal = await getDealById(id);
    if (!deal) return error("deal not found", 404);
    return json(deal);
  })) as Response;
}

/**
 * PATCH /api/deals/[id] (#254) — correct a deal's core identity or soft-archive
 * it. Owning-agent only: like stage (#167) and buyer-status (#184) writes, this
 * is scoped to the deal owner (updateMany where agent_id = caller → 404 for
 * anyone else, so strangers can't probe deal ids). Editable: title, address,
 * price, closing_date, status. `stage` is intentionally NOT editable here — it
 * carries a stage-history invariant and stays owned by /stage; the request
 * schema is `.strict()`, so a `stage` key 400s. A status change writes an audit
 * row. No hard delete — archive is a soft status flip; the row and all its
 * history survive.
 */
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;

  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    // Schema-validated (#88 pattern): unknown keys (incl. `stage`), a garbage
    // price/date, or an unknown status all 400 here instead of 500ing in PG.
    const parsed = await parseBody(req, dealPatchBodySchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    // Only touch columns the caller actually sent. `undefined` = absent (leave
    // as-is); an explicit `null` on a nullable field CLEARS it. title is
    // NOT NULL and cannot be blanked.
    const data: Prisma.dealsUpdateManyMutationInput = {};
    if (body.title !== undefined) {
      const t = body.title.trim();
      if (!t) return error("title cannot be empty", 400);
      data.title = t;
    }
    if (body.address !== undefined) data.address = body.address;
    if (body.price !== undefined) data.price = body.price;
    if (body.closing_date !== undefined) {
      data.closing_date =
        body.closing_date === null
          ? null
          : new Date(`${body.closing_date}T00:00:00.000Z`);
    }
    if (body.status !== undefined) data.status = body.status;

    if (Object.keys(data).length === 0) {
      return error("no editable fields provided", 400);
    }
    data.updated_at = new Date();

    // Capture the prior status for the audit trail (owner-scoped) before the
    // write; only needed when the caller is changing status.
    let fromStatus: string | undefined;
    if (body.status !== undefined) {
      const cur = await prisma.deals.findFirst({
        where: { id: dealId, agent_id: userId },
        select: { status: true },
      });
      fromStatus = cur?.status;
    }

    // Owner-scoped update: 404 (not 403) so strangers can't probe deal ids.
    const result = await prisma.deals.updateMany({
      where: { id: dealId, agent_id: userId },
      data,
    });
    if (result.count === 0) return error("deal not found", 404);

    // Lifecycle changes (archive / fallen_through / reactivate) are audited.
    // Skip a no-op status set (from === to).
    if (body.status !== undefined && fromStatus !== body.status) {
      await logAudit({
        actorId: userId,
        eventType: "deal_status_change",
        dealId,
        metadata: { from_status: fromStatus ?? null, to_status: body.status },
      });
    }

    const updated = await getDealById(dealId);
    return json(updated);
  })) as Response;
}
