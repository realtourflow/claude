/**
 * Test-only seeded-session endpoint for Playwright E2E.
 *
 * Upserts a user and mints a matching RS256 token (verifiable by the same
 * process via `getE2EVerifyOptions`). The Playwright helper stashes the returned
 * session in the `rtf_e2e_session` cookie; `TestAuthSetup` reads it to wire the
 * API token and populate the auth store — no real Auth0 round-trip.
 *
 * Hard-gated on `e2eAuthEnabled()`: returns 404 unless `E2E_AUTH` is explicitly
 * "1" AND we are not in Vercel production (`VERCEL_ENV !== "production"`). The
 * backstop guarantees this route is unreachable in production even if the flag
 * is set there by mistake.
 */
import { error } from "@/lib/http";
import { upsertUser } from "@/lib/users";
import { e2eAuthEnabled, signE2EToken } from "@/lib/test-auth";
import type { Role } from "@/lib/roles";

const VALID_ROLES: readonly Role[] = [
  "agent",
  "buyer",
  "seller",
  "admin",
  "tc",
  "lending_partner",
];

type Body = {
  sub?: string;
  email?: string;
  name?: string;
  role?: string;
};

export async function POST(req: Request): Promise<Response> {
  if (!e2eAuthEnabled()) return error("not found", 404);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  const role: Role = VALID_ROLES.includes(body.role as Role)
    ? (body.role as Role)
    : "agent";
  // Stable sub per role keeps one test user instead of accumulating rows across
  // runs; callers can override for isolation.
  const sub = typeof body.sub === "string" && body.sub ? body.sub : `e2e|${role}`;
  const email =
    typeof body.email === "string" && body.email
      ? body.email
      : `${sub.replace(/[^a-z0-9]/gi, "-")}@e2e.local`;
  const name =
    typeof body.name === "string" && body.name ? body.name : "E2E Test User";

  const user = await upsertUser({ auth0Id: sub, email, name, role });
  const token = await signE2EToken(sub, [role]);

  const session = {
    token,
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  return new Response(JSON.stringify(session), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": `rtf_e2e_session=${encodeURIComponent(
        JSON.stringify(session)
      )}; Path=/; SameSite=Lax`,
    },
  });
}
