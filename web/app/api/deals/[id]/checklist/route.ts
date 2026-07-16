import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import {
  CHECKLIST_ELIGIBLE_STAGES,
  DEFAULT_CHECKLIST_ITEMS,
  checklistHasAccess,
  sellerDefaultsFor,
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

    const deal = await prisma.deals.findUnique({
      where: { id: dealId },
      select: { type: true, stage: true, checklist_seeded_at: true },
    });

    // Seller-portal defaults (#261): seed the stage-appropriate seller set for
    // sell deals (listing prep at active_search, final prep at pre_close). This
    // is intentionally INDEPENDENT of the checklist_seeded_at marker: a sell
    // deal seeds seller items at active_search AND, later, the TC set at
    // under_contract, so one boolean marker can't gate both. Idempotency here
    // comes from the partial unique index on (deal_id, label) WHERE NOT
    // is_custom — skipDuplicates makes a re-GET at the same stage a no-op — and
    // we deliberately do NOT stamp checklist_seeded_at, leaving the TC seeding
    // path (#264) untouched.
    if (deal) {
      const sellerDefaults = sellerDefaultsFor(deal.type, deal.stage);
      if (sellerDefaults.length > 0) {
        await prisma.checklist_items.createMany({
          data: sellerDefaults.map((d, i) => ({
            deal_id: dealId,
            label: d.label,
            category: d.category,
            assigned_to: d.assignedTo,
            sort_order: i,
          })),
          skipDuplicates: true,
        });
      }
    }

    // Auto-seed the TC closing defaults exactly once per deal, at an eligible
    // stage. The persistent marker deals.checklist_seeded_at — NOT a live item
    // count — decides "seeded before?", so an intentionally emptied checklist
    // stays empty instead of resurrecting all 17 defaults on the next load
    // (#264).
    if (
      deal &&
      deal.checklist_seeded_at === null &&
      CHECKLIST_ELIGIBLE_STAGES.has(deal.stage)
    ) {
      // Seed the rows and stamp the marker in one transaction. Two concurrent
      // first-opens can both read checklist_seeded_at IS NULL (#90):
      // skipDuplicates emits ON CONFLICT DO NOTHING so the loser no-ops against
      // the partial unique index on (deal_id, label) WHERE NOT is_custom, and
      // the marker UPDATE is idempotent (both write ~now()); both callers then
      // read the winner's rows below.
      await prisma.$transaction([
        prisma.checklist_items.createMany({
          data: DEFAULT_CHECKLIST_ITEMS.map((d, i) => ({
            deal_id: dealId,
            label: d.label,
            category: d.category,
            assigned_to: d.assignedTo,
            sort_order: i,
          })),
          skipDuplicates: true,
        }),
        prisma.deals.update({
          where: { id: dealId },
          data: { checklist_seeded_at: new Date() },
        }),
      ]);
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
