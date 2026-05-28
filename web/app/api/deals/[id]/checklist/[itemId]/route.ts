import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { checklistHasAccess } from "@/lib/checklist";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

type PatchBody = {
  checked?: boolean;
  assigned_to?: string;
  due_date?: string | null;
};

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId, itemId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    if (!(await checklistHasAccess(dealId, userId, claims.roles))) {
      return error("deal not found", 404);
    }

    let body: PatchBody;
    try {
      body = (await req.json()) as PatchBody;
    } catch {
      return error("invalid body", 400);
    }

    if (typeof body.checked === "boolean") {
      await prisma.$executeRaw`
        UPDATE checklist_items
        SET checked = ${body.checked}, updated_at = NOW()
        WHERE id = ${itemId}::uuid AND deal_id = ${dealId}::uuid
      `;
    }
    if (typeof body.assigned_to === "string") {
      await prisma.$executeRaw`
        UPDATE checklist_items
        SET assigned_to = ${body.assigned_to}::checklist_assignee, updated_at = NOW()
        WHERE id = ${itemId}::uuid AND deal_id = ${dealId}::uuid
      `;
    }
    if (body.due_date !== undefined) {
      if (body.due_date === null || body.due_date === "") {
        await prisma.$executeRaw`
          UPDATE checklist_items SET due_date = NULL, updated_at = NOW()
          WHERE id = ${itemId}::uuid AND deal_id = ${dealId}::uuid
        `;
      } else {
        await prisma.$executeRaw`
          UPDATE checklist_items SET due_date = ${body.due_date}::date, updated_at = NOW()
          WHERE id = ${itemId}::uuid AND deal_id = ${dealId}::uuid
        `;
      }
    }

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
      SELECT id, deal_id, label, category, checked,
             assigned_to::text AS assigned_to,
             due_date::text AS due_date, is_custom, sort_order
      FROM checklist_items
      WHERE id = ${itemId}::uuid AND deal_id = ${dealId}::uuid
    `;
    if (rows.length === 0) return error("item not found", 404);
    return json(rows[0]);
  })) as Response;
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId, itemId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    if (!(await checklistHasAccess(dealId, userId, claims.roles))) {
      return error("deal not found", 404);
    }
    await prisma.checklist_items.deleteMany({
      where: { id: itemId, deal_id: dealId },
    });
    return json({ status: "ok" });
  })) as Response;
}
