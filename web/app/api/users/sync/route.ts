import { error, json, withAuth } from "@/lib/http";
import { EmailConflictError, getPersistedRole, upsertUser } from "@/lib/users";
import type { Role } from "@/lib/roles";

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
      role = claims.roles[0] as Role;
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
