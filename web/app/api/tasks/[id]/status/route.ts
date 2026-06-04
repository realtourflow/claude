import { prisma } from "@/lib/db";
import { error, json, withAuth } from "@/lib/http";
import { resolveUserId } from "@/lib/users";
import { enqueuePushTaskDueEvent } from "@/lib/jobs";
import type { TaskStatus } from "@/lib/stages";

type Ctx = { params: Promise<{ id: string }> };

type StatusBody = { status?: string };

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

const VALID_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  "pending",
  "in_progress",
  "completed",
  "skipped",
]);

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id: taskId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    let body: StatusBody;
    try {
      body = (await req.json()) as StatusBody;
    } catch {
      return error("invalid request body", 400);
    }
    if (!body.status || !VALID_STATUSES.has(body.status as TaskStatus)) {
      return error("invalid status", 400);
    }

    const rows = await prisma.$queryRaw<TaskRow[]>`
      UPDATE tasks
      SET status = ${body.status}::task_status, updated_at = NOW()
      WHERE id = ${taskId}::uuid
        AND deal_id IN (SELECT id FROM deals WHERE agent_id = ${userId}::uuid)
      RETURNING id, deal_id, assigned_to, title, description,
                status::text AS status, priority, source, stage_context, role,
                due_date::text AS due_date, created_at, updated_at
    `;
    if (rows.length === 0) return error("task not found", 404);

    const task = rows[0];
    // Best-effort calendar sync; await (not detached) so it runs on Vercel.
    try {
      await enqueuePushTaskDueEvent(task.id);
    } catch (err) {
      console.error("calendar push (task due) failed", err);
    }
    return json(task);
  })) as Response;
}
