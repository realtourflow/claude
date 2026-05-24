import { prisma } from "@/lib/db";
import type { Role } from "@/lib/roles";

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
