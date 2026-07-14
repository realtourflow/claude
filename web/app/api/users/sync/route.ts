import { error, json, withAuth } from "@/lib/http";
import { EmailConflictError, getPersistedRole, upsertUser } from "@/lib/users";
import { ROLES, resolveRole, type Role } from "@/lib/roles";

type SyncBody = {
  email?: string;
  name?: string;
};

export async function POST(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    let body: SyncBody;
    try {
      body = (await req.json()) as SyncBody;
    } catch {
      return error("invalid request body", 400);
    }
    const email = typeof body.email === "string" ? body.email : "";
    const name = typeof body.name === "string" ? body.name : "";

    // Prefer the JWT roles claim; fall back to whatever role the agent invite
    // claim previously persisted. No role anywhere = 403.
    let role: Role | null = null;
    if (claims.roles.length > 0) {
      // Resolve the claim to the single most-privileged RECOGNIZED role
      // (precedence documented in lib/roles.ts). A claim carrying only
      // unrecognized roles is a misconfigured/typo'd Auth0 role — reject it
      // with a clear 400 instead of casting it straight to Role and letting the
      // user_role enum reject it downstream as an opaque 500 (#308).
      role = resolveRole(claims.roles);
      if (!role) {
        return error(
          `unrecognized role claim (${JSON.stringify(
            claims.roles
          )}); expected one of: ${ROLES.join(", ")}`,
          400
        );
      }
    } else {
      role = await getPersistedRole(claims.sub);
    }
    if (!role) {
      return error(
        "no role assigned — request an invite from your administrator",
        403
      );
    }

    let user;
    try {
      user = await upsertUser({
        auth0Id: claims.sub,
        email,
        name,
        role,
      });
    } catch (err) {
      // A second Auth0 identity reusing another user's email surfaces as a
      // typed collision — return a readable 409 instead of a generic 500 so
      // the client can recover (log in with the original account) (#277).
      if (err instanceof EmailConflictError) {
        return error(err.message, err.status);
      }
      throw err;
    }
    return json(user);
  })) as Response;
}
