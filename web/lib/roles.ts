import { AuthError } from "./auth";

export { AuthError };

/**
 * The six roles the platform recognizes — the single source of truth. `Role` is
 * derived from it, `isValidRole` guards against anything else, and it mirrors
 * the Postgres `user_role` enum. Adding a role means adding it here AND to the
 * enum via a migration (and to ROLE_PRECEDENCE below).
 */
export const ROLES = [
  "agent",
  "buyer",
  "seller",
  "admin",
  "tc",
  "lending_partner",
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Runtime whitelist check for an untrusted role string (e.g. a JWT `roles`
 * claim). Narrows to `Role` so callers stop reaching for an unchecked
 * `as Role` cast — that cast is exactly what let a typo'd or misconfigured
 * Auth0 role slip through to the DB `user_role` enum and surface as an opaque
 * 500 instead of a clear 4xx (#308).
 */
export function isValidRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Precedence for collapsing a multi-role JWT claim to one role, most privileged
 * first. A token should normally carry exactly one role; when it carries
 * several we resolve deterministically to the most privileged rather than
 * silently taking whichever happened to be first in the array (#308).
 *
 * admin > tc > agent > lending_partner > seller > buyer:
 *   - admin           — platform-wide administration
 *   - tc              — transaction coordinator; works across many agents' deals
 *   - agent           — owns and manages their own deals (full CRUD, invites)
 *   - lending_partner — read access to loan data on linked deals
 *   - seller / buyer  — client portal, scoped to a single deal
 */
const ROLE_PRECEDENCE: readonly Role[] = [
  "admin",
  "tc",
  "agent",
  "lending_partner",
  "seller",
  "buyer",
];

/**
 * Collapses a JWT `roles` claim to the single most-privileged recognized role,
 * ignoring any unrecognized entries. Returns null when the claim contains no
 * recognized role at all — the caller turns that into a clear 4xx instead of
 * letting a bad value hit the `user_role` enum (#308).
 */
export function resolveRole(claimRoles: readonly string[]): Role | null {
  for (const role of ROLE_PRECEDENCE) {
    if (claimRoles.includes(role)) return role;
  }
  return null;
}

export function hasRole(
  userRoles: readonly string[],
  allowed: readonly string[]
): boolean {
  if (allowed.length === 0) return false;
  for (const role of userRoles) {
    if (allowed.includes(role)) return true;
  }
  return false;
}

export function requireRole(
  userRoles: readonly string[],
  allowed: readonly string[]
): void {
  if (!hasRole(userRoles, allowed)) {
    throw new AuthError(
      `role required (one of: ${allowed.join(", ")})`,
      403
    );
  }
}
