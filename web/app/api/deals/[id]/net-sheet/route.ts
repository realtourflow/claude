import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { hasDealAccess } from "@/lib/deals";
import { buildDefaultLines, parseAgentCommissionSettings } from "@/lib/net-sheet";

type Ctx = { params: Promise<{ id: string }> };

// GET — fetch, or auto-create seeded with the default deduction lines (#181).
// Agents always see the sheet; participants only see it once status = 'ready'
// (the client hook maps the 403 to its "not ready" state).
export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    const deal = await prisma.deals.findUnique({
      where: { id: dealId },
      select: { type: true, price: true, agent_id: true, commission_pct: true },
    });
    if (!deal) return error("deal not found", 404);

    const isAgent = deal.agent_id === userId;
    if (!isAgent && !(await hasDealAccess(dealId, userId))) {
      return error("deal not found", 404);
    }

    const existing = await prisma.net_sheets.findUnique({ where: { deal_id: dealId } });
    if (existing) {
      if (!isAgent && existing.status !== "ready") {
        return error("net sheet not ready", 403);
      }
      return json(existing);
    }

    // No sheet yet — only the deal's agent triggers creation.
    if (!isAgent) return error("net sheet not ready", 403);

    const settingsRow = await prisma.user_settings.findUnique({
      where: { user_id: deal.agent_id },
      select: { settings: true },
    });

    const salePrice = deal.price === null ? 0 : Math.round(Number(deal.price));
    const lines = buildDefaultLines({
      dealType: deal.type,
      salePrice,
      settings: parseAgentCommissionSettings(settingsRow?.settings),
      dealCommissionPct: deal.commission_pct === null ? null : Number(deal.commission_pct),
    });

    const row = await prisma.net_sheets.create({
      data: { deal_id: dealId, sale_price: salePrice, lines },
    });
    return json(row, 201);
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
