import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import {
  contingencyHasAccess,
  toApiContingency,
  type RawContingencyRow,
} from "@/lib/contingencies";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);
    if (!(await contingencyHasAccess(dealId, userId, claims.roles))) {
      return error("forbidden", 403);
    }
    const rows = await prisma.$queryRaw<RawContingencyRow[]>`
      SELECT id, deal_id, label, contingency_type, deadline::text AS deadline,
             waived_at, met_at, notes, sort_order, created_at
      FROM deal_contingencies
      WHERE deal_id = ${dealId}::uuid
      ORDER BY sort_order, created_at
    `;
    return json(rows.map(toApiContingency));
  })) as Response;
}

type CreateBody = {
  label?: string;
  contingency_type?: string;
  deadline?: string | null;
  notes?: string | null;
};

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);
    if (!(await contingencyHasAccess(dealId, userId, claims.roles))) {
      return error("forbidden", 403);
    }

    let body: CreateBody;
    try {
      body = (await req.json()) as CreateBody;
    } catch {
      return error("invalid request body", 400);
    }
    if (!body.label) return error("label is required", 400);

    const next = await prisma.deal_contingencies.aggregate({
      _max: { sort_order: true },
      where: { deal_id: dealId },
    });
    const nextOrder = (next._max.sort_order ?? -1) + 1;

    const rows = await prisma.$queryRaw<RawContingencyRow[]>`
      INSERT INTO deal_contingencies (deal_id, label, contingency_type, deadline, notes, sort_order)
      VALUES (${dealId}::uuid, ${body.label}, ${body.contingency_type ?? "custom"},
              ${body.deadline ?? null}::date,
              ${body.notes ?? null},
              ${nextOrder})
      RETURNING id, deal_id, label, contingency_type, deadline::text AS deadline,
                waived_at, met_at, notes, sort_order, created_at
    `;
    return json(toApiContingency(rows[0]), 201);
  })) as Response;
}
