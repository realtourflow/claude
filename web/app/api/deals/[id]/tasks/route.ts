import { prisma } from "@/lib/db";
import { error, json, withAuth } from "@/lib/http";
import { resolveUserId } from "@/lib/users";
import { enqueuePushTaskDueEvent } from "@/lib/jobs";

type Ctx = { params: Promise<{ id: string }> };

type TaskRow = {
  id: string;
  deal_id: string;
  assigned_to: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  source: string;
  stage_context: string | null;
  role: string;
  due_date: string | null;
  created_at: Date;
  updated_at: Date;
};

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    const owned = await prisma.deals.findFirst({
      where: { id: dealId, agent_id: userId },
      select: { id: true },
    });
    if (!owned) return error("deal not found", 404);

    const tasks = await prisma.$queryRaw<TaskRow[]>`
      SELECT id, deal_id, assigned_to, title, description,
             status::text AS status, priority, source, stage_context, role,
             due_date::text AS due_date, created_at, updated_at
      FROM tasks
      WHERE deal_id = ${dealId}::uuid
      ORDER BY created_at ASC
    `;
    return json(tasks);
  })) as Response;
}

type CreateBody = {
  title?: string;
  description?: string | null;
  priority?: string;
  source?: string;
  stage_context?: string | null;
  role?: string;
  due_date?: string | null;
};

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

    let body: CreateBody;
    try {
      body = (await req.json()) as CreateBody;
    } catch {
      return error("invalid request body", 400);
    }
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return error("title is required", 400);
    const priority = body.priority?.trim() || "medium";
    const source = body.source?.trim() || "manual";
    const role = body.role?.trim() || "agent";
    const description = body.description ?? null;
    const stageContext = body.stage_context ?? null;
    const dueDate = body.due_date ?? null;

    const rows = await prisma.$queryRaw<TaskRow[]>`
      INSERT INTO tasks (deal_id, title, description, priority, source, stage_context, role, due_date)
      VALUES (${dealId}::uuid, ${title}, ${description}, ${priority}, ${source},
              ${stageContext}, ${role}, ${dueDate}::date)
      RETURNING id, deal_id, assigned_to, title, description,
                status::text AS status, priority, source, stage_context, role,
                due_date::text AS due_date, created_at, updated_at
    `;
    const task = rows[0];
    // Best-effort calendar sync; await (not detached) so it runs on Vercel.
    if (task.due_date) {
      try {
        await enqueuePushTaskDueEvent(task.id);
      } catch (err) {
        console.error("calendar push (task due) failed", err);
      }
    }
    return json(task, 201);
  })) as Response;
}
