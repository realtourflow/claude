/**
 * Shared HTTP helpers for route handlers.
 *
 * - `json(data, status?)` — return JSON with the right Content-Type.
 * - `error(message, status)` — return a plain-text error matching the Go
 *   backend's `http.Error` semantics.
 * - `withAuth(req, handler, allowedRoles?)` — verifies JWT, optionally checks
 *   role overlap, and translates AuthError to the right HTTP status.
 */
import { AuthError, verifyAuth0Jwt, type AuthClaims, type VerifyOptions } from "./auth";
import { requireRole } from "./roles";

export function json<T>(data: T, status = 200): Response {
  return Response.json(data as object, { status });
}

export function error(message: string, status: number): Response {
  return new Response(`${message}\n`, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export type AuthedHandler<T> = (claims: AuthClaims) => Promise<T> | T;

export async function withAuth<T>(
  req: Request,
  handler: AuthedHandler<T>,
  opts?: { allowedRoles?: readonly string[]; verifyOpts?: VerifyOptions }
): Promise<Response | T> {
  try {
    const claims = await verifyAuth0Jwt(req, opts?.verifyOpts);
    if (opts?.allowedRoles) {
      requireRole(claims.roles, opts.allowedRoles);
    }
    return await handler(claims);
  } catch (err) {
    if (err instanceof AuthError) {
      return error(err.message, err.status);
    }
    console.error("unhandled error in route handler", err);
    return error("internal server error", 500);
  }
}
