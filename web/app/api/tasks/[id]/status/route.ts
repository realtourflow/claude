import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db";
import { error, json, withAuth } from "@/lib/http";
import { resolveUserId } from "@/lib/users";
import { hasDealAccess } from "@/lib/deals";
import { enqueuePushTaskDueEvent } from "@/lib/jobs";
import { isValidDueDateString } from "@/lib/task-due-dates";
import type { TaskStatus } from "@/lib/stages";
import { patchTaskBodySchema } from "@/lib/schemas/task";
import { parseBody } from "@/lib/schemas/parse";

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

const VALID_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  "pending",
  "in_progress",
  "completed",
  "skipped",
]);

// The assignee-role bucket the Tasks-tab reassign dropdown changes (#255):
// the same set task-create seeds and `Task['assignedTo']` allows.
const VALID_ROLES: ReadonlySet<string> = new Set<string>([
  "agent",
  "tc",
  "buyer",
  "seller",
  "third_party",
  "admin",
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id: taskId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    // Schema-validated (#88). PATCH accepts any combination of the editable
    // fields: `status` keeps its original semantics (any deal member may
    // update it); `due_date` / `assigned_to` (#187) and `role` (#255, the
    // reassign-dropdown handoff bucket) are agent-only.
    const parsed = await parseBody(req, patchTaskBodySchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const hasStatus = "status" in body;
    const hasDueDate = "due_date" in body;
    const hasAssignee = "assigned_to" in body;
    const hasRole = "role" in body;
    if (!hasStatus && !hasDueDate && !hasAssignee && !hasRole) {
      return error("no fields to update", 400);
    }

    if (hasStatus && (!body.status || !VALID_STATUSES.has(body.status as TaskStatus))) {
      return error("invalid status", 400);
    }
    if (hasRole && (typeof body.role !== "string" || !VALID_ROLES.has(body.role))) {
      return error("invalid role", 400);
    }
    if (
      hasDueDate &&
      body.due_date !== null &&
      !(typeof body.due_date === "string" && isValidDueDateString(body.due_date))
    ) {
      return error("invalid due_date (expected YYYY-MM-DD)", 400);
    }
    if (
      hasAssignee &&
      body.assigned_to !== null &&
      !(typeof body.assigned_to === "string" && UUID_RE.test(body.assigned_to))
    ) {
      return error("assignee is not on this deal", 400);
    }

    // Authorize by deal access (agent owner OR participant), not agent-only:
    // resolve the task's deal first, then gate on hasDealAccess so buyers/sellers
    // on the deal can update their own tasks. A missing task or a caller without
    // access both 404 — same not-found semantics as before.
    const taskDeal = await prisma.tasks.findUnique({
      where: { id: taskId },
      select: { deal_id: true, deals: { select: { agent_id: true } } },
    });
    if (!taskDeal || !(await hasDealAccess(taskDeal.deal_id, userId))) {
      return error("task not found", 404);
    }

    // due_date / assigned_to / role edits are reserved for the deal's owning
    // agent — participants may only flip status (the pre-#187 behavior). The
    // agent↔TC handoff (#255) changes `role`, so it is gated the same way.
    if ((hasDueDate || hasAssignee || hasRole) && taskDeal.deals.agent_id !== userId) {
      return error("only the deal agent can edit due dates, assignees, or roles", 403);
    }

    // A non-null assignee must actually belong to the deal (owner or
    // participant) — guards the FK and keeps tasks inside the deal team.
    if (hasAssignee && body.assigned_to) {
      const member = await prisma.$queryRaw<{ ok: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM deals
          WHERE id = ${taskDeal.deal_id}::uuid AND (
            agent_id = ${body.assigned_to}::uuid OR
            EXISTS (
              SELECT 1 FROM deal_participants
              WHERE deal_id = ${taskDeal.deal_id}::uuid AND user_id = ${body.assigned_to}::uuid
            )
          )
        ) AS ok
      `;
      if (!member[0]?.ok) return error("assignee is not on this deal", 400);
    }

    const sets: Prisma.Sql[] = [];
    if (hasStatus) sets.push(Prisma.sql`status = ${body.status}::task_status`);
    if (hasDueDate) sets.push(Prisma.sql`due_date = ${body.due_date}::date`);
    if (hasAssignee) sets.push(Prisma.sql`assigned_to = ${body.assigned_to}::uuid`);
    if (hasRole) sets.push(Prisma.sql`role = ${body.role}`);
    sets.push(Prisma.sql`updated_at = NOW()`);

    const rows = await prisma.$queryRaw<TaskRow[]>(Prisma.sql`
      UPDATE tasks
      SET ${Prisma.join(sets, ", ")}
      WHERE id = ${taskId}::uuid
      RETURNING id, deal_id, assigned_to, title, description,
                status::text AS status, priority, source, stage_context, role,
                due_date::text AS due_date, created_at, updated_at
    `);
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
