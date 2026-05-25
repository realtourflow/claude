import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { hasDealAccess } from "@/lib/deals";

type Ctx = { params: Promise<{ id: string }> };

// GET — fetch or auto-create.
export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    if (!(await hasDealAccess(dealId, userId))) return error("deal not found", 404);

    let row = await prisma.net_sheets.findUnique({ where: { deal_id: dealId } });
    if (!row) {
      row = await prisma.net_sheets.create({
        data: { deal_id: dealId },
      });
    }
    return json(row);
  })) as Response;
}

type PutBody = {
  sale_price?: number;
  closing_date?: string;
  annual_taxes?: number;
  lines?: unknown;
  status?: string;
};

// PUT — update fields.
export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    const owned = await prisma.deals.findFirst({
      where: { id: dealId, agent_id: userId },
      select: { id: true },
    });
    if (!owned) return error("deal not found", 404);

    let body: PutBody;
    try {
      body = (await req.json()) as PutBody;
    } catch {
      return error("invalid request body", 400);
    }
    const data: Record<string, unknown> = { updated_at: new Date() };
    if (typeof body.sale_price === "number") data.sale_price = body.sale_price;
    if (typeof body.annual_taxes === "number") data.annual_taxes = body.annual_taxes;
    if (typeof body.status === "string") data.status = body.status;
    if (body.closing_date !== undefined) {
      data.closing_date = body.closing_date ? new Date(body.closing_date) : null;
    }
    if (body.lines !== undefined) data.lines = body.lines;

    const row = await prisma.net_sheets.upsert({
      where: { deal_id: dealId },
      create: { deal_id: dealId, ...data },
      update: data,
    });
    return json(row);
  })) as Response;
}
