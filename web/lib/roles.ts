import { AuthError } from "./auth";

export { AuthError };

export type Role = "agent" | "buyer" | "seller" | "admin" | "tc" | "lending_partner";

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
