import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import {
  contingencyHasAccess,
  toApiContingency,
  type RawContingencyRow,
} from "@/lib/contingencies";

type Ctx = { params: Promise<{ id: string; contingencyId: string }> };

type PatchBody = {
  label?: string;
  deadline?: string | null;
  notes?: string | null;
  status?: "active" | "waived" | "removed";
};

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId, contingencyId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);
    if (!(await contingencyHasAccess(dealId, userId, claims.roles))) {
      return error("forbidden", 403);
    }

    let body: PatchBody;
    try {
      body = (await req.json()) as PatchBody;
    } catch {
      return error("invalid request body", 400);
    }

    if (typeof body.label === "string") {
      await prisma.$executeRaw`
        UPDATE deal_contingencies SET label = ${body.label}, updated_at = NOW()
        WHERE id = ${contingencyId}::uuid AND deal_id = ${dealId}::uuid
      `;
    }
    if (body.deadline !== undefined) {
      if (body.deadline === null || body.deadline === "") {
        await prisma.$executeRaw`
          UPDATE deal_contingencies SET deadline = NULL, updated_at = NOW()
          WHERE id = ${contingencyId}::uuid AND deal_id = ${dealId}::uuid
        `;
      } else {
        await prisma.$executeRaw`
          UPDATE deal_contingencies SET deadline = ${body.deadline}::date, updated_at = NOW()
          WHERE id = ${contingencyId}::uuid AND deal_id = ${dealId}::uuid
        `;
      }
    }
    if (body.notes !== undefined) {
      await prisma.$executeRaw`
        UPDATE deal_contingencies SET notes = ${body.notes}, updated_at = NOW()
        WHERE id = ${contingencyId}::uuid AND deal_id = ${dealId}::uuid
      `;
    }
    if (body.status === "waived") {
      await prisma.$executeRaw`
        UPDATE deal_contingencies SET waived_at = NOW(), met_at = NULL, updated_at = NOW()
        WHERE id = ${contingencyId}::uuid AND deal_id = ${dealId}::uuid
      `;
    } else if (body.status === "removed") {
      await prisma.$executeRaw`
        UPDATE deal_contingencies SET met_at = NOW(), waived_at = NULL, updated_at = NOW()
        WHERE id = ${contingencyId}::uuid AND deal_id = ${dealId}::uuid
      `;
    } else if (body.status === "active") {
      await prisma.$executeRaw`
        UPDATE deal_contingencies SET waived_at = NULL, met_at = NULL, updated_at = NOW()
        WHERE id = ${contingencyId}::uuid AND deal_id = ${dealId}::uuid
      `;
    }

    const rows = await prisma.$queryRaw<RawContingencyRow[]>`
      SELECT id, deal_id, label, contingency_type, deadline::text AS deadline,
             waived_at, met_at, notes, sort_order, created_at
      FROM deal_contingencies
      WHERE id = ${contingencyId}::uuid AND deal_id = ${dealId}::uuid
    `;
    if (rows.length === 0) return error("contingency not found", 404);
    return json(toApiContingency(rows[0]));
  })) as Response;
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId, contingencyId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);
    if (!(await contingencyHasAccess(dealId, userId, claims.roles))) {
      return error("forbidden", 403);
    }
    const result = await prisma.deal_contingencies.deleteMany({
      where: { id: contingencyId, deal_id: dealId },
    });
    if (result.count === 0) return error("not found", 404);
    return new Response(null, { status: 204 });
  })) as Response;
}
