import { prisma } from "@/lib/db";
import type { Role } from "@/lib/roles";
import type { DealStage, DealType, TaskStatus } from "@/lib/stages";

let counter = 0;

export type TestUser = {
  id: string;
  auth0_id: string;
  email: string;
  name: string;
  role: Role;
};

export async function createUser(overrides: Partial<TestUser> = {}): Promise<TestUser> {
  counter += 1;
  const seq = counter;
  const user = await prisma.users.create({
    data: {
      auth0_id: overrides.auth0_id ?? `auth0|test-${seq}`,
      email: overrides.email ?? `test-${seq}@example.com`,
      name: overrides.name ?? `Test User ${seq}`,
      role: (overrides.role ?? "agent") as Role,
    },
    select: { id: true, auth0_id: true, email: true, name: true, role: true },
  });
  return user as TestUser;
}

export type TestDeal = {
  id: string;
  agent_id: string;
  type: DealType;
  stage: DealStage;
  title: string;
};

export async function createDeal(
  overrides: Partial<TestDeal> & { agent_id: string }
): Promise<TestDeal> {
  counter += 1;
  const seq = counter;
  const deal = await prisma.deals.create({
    data: {
      agent_id: overrides.agent_id,
      type: (overrides.type ?? "buy") as DealType,
      stage: (overrides.stage ?? "intake") as DealStage,
      title: overrides.title ?? `Test Deal ${seq}`,
    },
    select: { id: true, agent_id: true, type: true, stage: true, title: true },
  });
  return deal as TestDeal;
}

export type TestTask = {
  id: string;
  deal_id: string;
  title: string;
  status: TaskStatus;
  priority: string;
  due_date: Date | null;
  stage_context: string | null;
};

export async function createTask(
  overrides: Partial<TestTask> & { deal_id: string }
): Promise<TestTask> {
  counter += 1;
  const seq = counter;
  const task = await prisma.tasks.create({
    data: {
      deal_id: overrides.deal_id,
      title: overrides.title ?? `Test Task ${seq}`,
      status: (overrides.status ?? "pending") as TaskStatus,
      priority: overrides.priority ?? "medium",
      due_date: overrides.due_date ?? null,
      stage_context: overrides.stage_context ?? null,
    },
    select: {
      id: true,
      deal_id: true,
      title: true,
      status: true,
      priority: true,
      due_date: true,
      stage_context: true,
    },
  });
  return task as TestTask;
}
