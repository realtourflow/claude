import { error, json, withAuth } from "@/lib/http";
import { resolveUserId } from "@/lib/users";
import { hasRole } from "@/lib/roles";
import { sendInviteEmail } from "@/lib/email";

type ClientInviteBody = {
  email?: string;
  name?: string;
  role?: "buyer" | "seller";
};

export async function POST(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const isAgent = hasRole(claims.roles, ["agent"]);
    const isAdmin = hasRole(claims.roles, ["admin"]);
    if (!isAgent && !isAdmin) return error("forbidden", 403);

    const agentId = await resolveUserId(claims.sub);
    if (!agentId) return error("user not found", 401);

    let body: ClientInviteBody;
    try {
      body = (await req.json()) as ClientInviteBody;
    } catch {
      return error("invalid request body", 400);
    }
    if (
      !body.email ||
      !body.name ||
      (body.role !== "buyer" && body.role !== "seller")
    ) {
      return error("email, name, and role (buyer|seller) are required", 400);
    }

    // Onboarding links are stateless and agent-scoped — there is no DB row to
    // write. The link carries the agent id; the client appears in the agent's
    // pipeline once they finish onboarding.
    const url = new URL(req.url);
    const origin = `${url.protocol}//${url.host}`;
    const inviteUrl = `${origin}/onboard/${body.role}?agent=${agentId}`;

    // Best-effort: email the client their onboarding link. A delivery failure
    // must never fail the response — swallow + log and still return 200.
    try {
      await sendInviteEmail({
        to: body.email,
        name: body.name,
        dealTitle: body.role === "seller" ? "your home sale" : "your home search",
        inviteUrl,
      });
    } catch (err) {
      console.error("failed to send client invite email", err);
    }

    return json({ ok: true, inviteUrl });
  })) as Response;
}
