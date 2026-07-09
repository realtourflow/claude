import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "./db";
import { AuthError } from "./auth";
import type { Role } from "./roles";

export type SyncedUser = {
  id: string;
  auth0_id: string;
  email: string;
  name: string;
  role: Role;
  phone: string | null;
  onboarding_complete: boolean;
  created_at: Date;
  updated_at: Date;
};

/**
 * Upserts a user from JWT data. Preserves a hand-edited name when Auth0 is
 * about to clobber it with the email (Auth0 sometimes defaults name=email).
 *
 * Mirrors upsertUser in the legacy Go backend.
 */
export async function upsertUser(input: {
  auth0Id: string;
  email: string;
  name: string;
  role: Role;
  /**
   * When true, an existing row KEEPS its current role — `input.role` only
   * applies on first insert. Invite claims use this so claiming can never
   * demote an existing account (#174: an agent opening their own client
   * invite must not become a buyer). Default (false) preserves the
   * historical overwrite for /users/sync, whose role comes from the JWT.
   */
  keepExistingRole?: boolean;
}): Promise<SyncedUser> {
  const roleOnConflict = input.keepExistingRole
    ? Prisma.sql`users.role`
    : Prisma.sql`EXCLUDED.role`;
  // Raw SQL keeps the CASE-WHEN name-preserve logic exactly as the Go side.
  const rows = await prisma.$queryRaw<SyncedUser[]>`
    INSERT INTO users (auth0_id, email, name, role)
    VALUES (${input.auth0Id}, ${input.email}, ${input.name}, ${input.role}::user_role)
    ON CONFLICT (auth0_id) DO UPDATE
    SET email      = EXCLUDED.email,
        name       = CASE
                       WHEN users.name IS NULL OR users.name = '' OR users.name = users.email
                       THEN EXCLUDED.name
                       ELSE users.name
                     END,
        role       = ${roleOnConflict},
        updated_at = NOW()
    RETURNING id, auth0_id, email, name, role, phone, onboarding_complete, created_at, updated_at
  `;
  return rows[0];
}

/**
 * Throws AuthError(403) when the auth0 subject maps to a deactivated user
 * row (users.deactivated_at set). A missing row passes — brand-new users
 * (first /users/sync, invite claims) have no row yet and must not be blocked.
 *
 * Called by withAuth (lib/http.ts) so a valid JWT alone is never enough:
 * deactivation revokes access on every protected route immediately (#173).
 */
export async function assertNotDeactivated(auth0Id: string): Promise<void> {
  const row = await prisma.users.findUnique({
    where: { auth0_id: auth0Id },
    select: { deactivated_at: true },
  });
  if (row?.deactivated_at) {
    throw new AuthError("account deactivated", 403);
  }
}

/**
 * Looks up the DB user id for a given auth0 subject. Returns null if no row.
 * Throws AuthError(403) for a deactivated user — defense in depth on top of
 * the withAuth choke point (#173).
 */
export async function resolveUserId(auth0Id: string): Promise<string | null> {
  const row = await prisma.users.findUnique({
    where: { auth0_id: auth0Id },
    select: { id: true, deactivated_at: true },
  });
  if (row?.deactivated_at) {
    throw new AuthError("account deactivated", 403);
  }
  return row?.id ?? null;
}

/**
 * Looks up just the persisted role for an auth0 subject. Returns null if no
 * row exists. Used when the JWT has no roles claim (e.g. brand-new agent
 * who claimed an invite before the Auth0 action fired).
 * Throws AuthError(403) for a deactivated user (#173).
 */
export async function getPersistedRole(auth0Id: string): Promise<Role | null> {
  const row = await prisma.users.findUnique({
    where: { auth0_id: auth0Id },
    select: { role: true, deactivated_at: true },
  });
  if (row?.deactivated_at) {
    throw new AuthError("account deactivated", 403);
  }
  return (row?.role as Role | undefined) ?? null;
}
