import { error, json, withAuth } from "@/lib/http";
import { getPersistedRole, upsertUser } from "@/lib/users";
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

    const user = await upsertUser({
      auth0Id: claims.sub,
      email,
      name,
      role,
    });
    return json(user);
  })) as Response;
}
