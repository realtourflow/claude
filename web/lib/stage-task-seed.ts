import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "./db";
import { stageAutoTasks, type AutoTaskDeal } from "./stage-auto-tasks";
import { autoTaskDueDate } from "./task-due-dates";

/**
 * Seed a stage's AI auto-tasks when a deal enters that stage (#87).
 *
 * Moved server-side from the browser: DealDetail used to loop POST /tasks after
 * the stage advance, so a tab closed mid-loop (or any non-UI caller) left an
 * advanced deal with missing tasks. The stage PATCH handler now seeds them in
 * one shot, next to the gate/history/contingency logic.
 *
 * Idempotent + race-safe, mirroring `seedStandardContingencies` (#186): a
 * single `INSERT ... SELECT ... WHERE NOT EXISTS` that only fires when the deal
 * has no AI task for this stage yet — so a retry, a double-submit, or a
 * re-entry into the stage never double-seeds. Per-stage default due dates match
 * the old client behavior via `autoTaskDueDate` (#187). No-op for stages with
 * no automation (the generator returns an empty list).
 */
export async function seedStageAutoTasks(
  dealId: string,
  stage: string,
  deal: AutoTaskDeal
): Promise<void> {
  const tasks = stageAutoTasks(stage, deal);
  if (tasks.length === 0) return;

  // Each row is fully cast so Postgres can infer the VALUES column types (a
  // bare parameter list in a standalone VALUES has no type context otherwise).
  const rows = tasks.map(
    (t) => Prisma.sql`(
      ${dealId}::uuid,
      ${t.title}::text,
      ${t.description ?? null}::text,
      ${t.priority}::varchar,
      'ai'::varchar,
      ${stage}::varchar,
      ${t.assignedTo}::varchar,
      ${autoTaskDueDate(stage, t.priority)}::date
    )`
  );

  await prisma.$executeRaw`
    INSERT INTO tasks (deal_id, title, description, priority, source, stage_context, role, due_date)
    SELECT * FROM (VALUES ${Prisma.join(rows)})
      AS v(deal_id, title, description, priority, source, stage_context, role, due_date)
    WHERE NOT EXISTS (
      SELECT 1 FROM tasks
      WHERE deal_id = ${dealId}::uuid AND source = 'ai' AND stage_context = ${stage}
    )
  `;
}
