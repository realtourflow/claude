import { prisma } from "@/lib/db";
import { error, json, withAuth } from "@/lib/http";
import { resolveUserId } from "@/lib/users";
import { canReadDeal } from "@/lib/deals";
import { enqueuePushTaskDueEvent } from "@/lib/jobs";
import { emailTaskAssigned } from "@/lib/notification-email";
import { isValidDueDateString } from "@/lib/task-due-dates";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    // Read access (#167): agent owner, participant, linked TC, or admin.
    // Task writes below (POST) stay agent-owner-only.
    if (!(await canReadDeal(dealId, userId, claims.roles))) {
      return error("deal not found", 404);
    }

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
  assigned_to?: string | null;
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
    if (dueDate !== null && !(typeof dueDate === "string" && isValidDueDateString(dueDate))) {
      return error("invalid due_date (expected YYYY-MM-DD)", 400);
    }

    // Optional assignee. Only accept a user who actually belongs to this deal
    // (the agent owner or a participant) — guards the FK and prevents emailing
    // arbitrary users. An unknown id is treated as no assignment.
    let assignedTo: string | null = null;
    const requestedAssignee =
      typeof body.assigned_to === "string" ? body.assigned_to.trim() : "";
    if (requestedAssignee && UUID_RE.test(requestedAssignee)) {
      const member = await prisma.$queryRaw<{ ok: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM deals
          WHERE id = ${dealId}::uuid AND (
            agent_id = ${requestedAssignee}::uuid OR
            EXISTS (
              SELECT 1 FROM deal_participants
              WHERE deal_id = ${dealId}::uuid AND user_id = ${requestedAssignee}::uuid
            )
          )
        ) AS ok
      `;
      if (member[0]?.ok) assignedTo = requestedAssignee;
    }

    const rows = await prisma.$queryRaw<TaskRow[]>`
      INSERT INTO tasks (deal_id, assigned_to, title, description, priority, source, stage_context, role, due_date)
      VALUES (${dealId}::uuid, ${assignedTo}::uuid, ${title}, ${description}, ${priority}, ${source},
              ${stageContext}, ${role}, ${dueDate}::date)
      RETURNING id, deal_id, assigned_to, title, description,
                status::text AS status, priority, source, stage_context, role,
                due_date::text AS due_date, created_at, updated_at
    `;
    const task = rows[0];

    // Best-effort email to the assignee (never the assigner). Awaited (not
    // detached) so it sends on Vercel; a throw must never block the response.
    if (task.assigned_to) {
      try {
        await emailTaskAssigned({
          req,
          dealId,
          assigneeId: task.assigned_to,
          actorId: userId,
          taskTitle: task.title,
        });
      } catch (err) {
        console.error("task notification email failed", err);
      }
    }
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
