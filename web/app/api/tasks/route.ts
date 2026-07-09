import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db";
import { error, json, withAuth } from "@/lib/http";
import { hasRole } from "@/lib/roles";
import { resolveUserId } from "@/lib/users";

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

export async function GET(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    // Admins see all tasks; TCs only tasks on deals of agents who linked
    // them (users.tc_user_id) — never platform-wide (#172); agents their own.
    const filter = hasRole(claims.roles, ["admin"])
      ? Prisma.sql``
      : hasRole(claims.roles, ["tc"])
        ? Prisma.sql`WHERE d.agent_id IN (SELECT id FROM users WHERE tc_user_id = ${userId}::uuid)`
        : Prisma.sql`WHERE d.agent_id = ${userId}::uuid`;

    const tasks = await prisma.$queryRaw<TaskRow[]>`
      SELECT t.id, t.deal_id, t.assigned_to, t.title, t.description,
             t.status::text AS status, t.priority, t.source, t.stage_context, t.role,
             t.due_date::text AS due_date, t.created_at, t.updated_at
      FROM tasks t
      JOIN deals d ON d.id = t.deal_id
      ${filter}
      ORDER BY t.due_date ASC NULLS LAST, t.created_at ASC
    `;
    return json(tasks);
  })) as Response;
}
