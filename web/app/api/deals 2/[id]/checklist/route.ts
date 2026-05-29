import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import {
  CHECKLIST_ELIGIBLE_STAGES,
  DEFAULT_CHECKLIST_ITEMS,
  checklistHasAccess,
} from "@/lib/checklist";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    if (!(await checklistHasAccess(dealId, userId, claims.roles))) {
      return error("deal not found", 404);
    }

    // Auto-seed defaults if eligible stage + empty.
    const count = await prisma.checklist_items.count({ where: { deal_id: dealId } });
    if (count === 0) {
      const deal = await prisma.deals.findUnique({
        where: { id: dealId },
        select: { stage: true },
      });
      if (deal && CHECKLIST_ELIGIBLE_STAGES.has(deal.stage)) {
        await prisma.checklist_items.createMany({
          data: DEFAULT_CHECKLIST_ITEMS.map((d, i) => ({
            deal_id: dealId,
            label: d.label,
            category: d.category,
            assigned_to: d.assignedTo,
            sort_order: i,
          })),
        });
      }
    }

    const items = await prisma.$queryRaw<
      {
        id: string;
        deal_id: string;
        label: string;
        category: string;
        checked: boolean;
        assigned_to: string;
        due_date: string | null;
        is_custom: boolean;
        sort_order: number;
      }[]
    >`
      SELECT id, deal_id, label, category, checked, assigned_to::text AS assigned_to,
             due_date::text AS due_date, is_custom, sort_order
      FROM checklist_items
      WHERE deal_id = ${dealId}::uuid
      ORDER BY sort_order, created_at
    `;
    return json(items);
  })) as Response;
}

type CreateBody = {
  label?: string;
  category?: string;
  assigned_to?: string;
};

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    if (!(await checklistHasAccess(dealId, userId, claims.roles))) {
      return error("deal not found", 404);
    }

    let body: CreateBody;
    try {
      body = (await req.json()) as CreateBody;
    } catch {
      return error("label is required", 400);
    }
    if (!body.label) return error("label is required", 400);
    const category = body.category || "Contract";
    const assignedTo = body.assigned_to || "tc";

    const next = await prisma.checklist_items.aggregate({
      _max: { sort_order: true },
      where: { deal_id: dealId },
    });
    const nextOrder = (next._max.sort_order ?? -1) + 1;

    const rows = await prisma.$queryRaw<
      {
        id: string;
        deal_id: string;
        label: string;
        category: string;
        checked: boolean;
        assigned_to: string;
        due_date: string | null;
        is_custom: boolean;
        sort_order: number;
      }[]
    >`
      INSERT INTO checklist_items (deal_id, label, category, assigned_to, is_custom, sort_order)
      VALUES (${dealId}::uuid, ${body.label}, ${category},
              ${assignedTo}::checklist_assignee, TRUE, ${nextOrder})
      RETURNING id, deal_id, label, category, checked,
                assigned_to::text AS assigned_to,
                due_date::text AS due_date, is_custom, sort_order
    `;
    return json(rows[0]);
  })) as Response;
}
