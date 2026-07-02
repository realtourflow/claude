import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { hasRole } from "@/lib/roles";
import { sendInviteEmail } from "@/lib/email";

type ClientInviteBody = {
  email?: string;
  name?: string;
  role?: "buyer" | "seller";
};

// POST /api/me/client-invite — an agent (or admin) invites a prospective client.
//
// Creates a deal the inviting agent OWNS (so the client appears in that agent's
// pipeline at the 'intake' stage immediately) plus a claimable deal_invites
// token, then emails the account-first /invite/<token> link. The buyer accepts,
// creates an account, and is linked to this deal as a participant.
//
// This replaces the old *stateless* `/onboard/{role}?agent=<uuid>` link, which
// wrote no records: the buyer was never provisioned, never claimed anything,
// never appeared in the agent's pipeline, and dead-ended at the login screen.
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
    const dealType = body.role === "seller" ? "sell" : "buy";

    // Create the agent-owned deal, then the claimable invite. The codebase does
    // not use interactive transactions (driver-adapter), so on invite failure
    // we clean up the just-created deal to avoid an orphaned intake card.
    const dealRows = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO deals (agent_id, type, title, market)
      VALUES (${agentId}::uuid, ${dealType}::deal_type, ${body.name},
              COALESCE((SELECT market FROM users WHERE id = ${agentId}::uuid), ''))
      RETURNING id
    `;
    const dealId = dealRows[0].id;

    let token: string;
    try {
      const invRows = await prisma.$queryRaw<{ token: string }[]>`
        INSERT INTO deal_invites (deal_id, email, name, role, invited_by)
        VALUES (${dealId}::uuid, ${body.email}, ${body.name}, ${body.role}, ${agentId}::uuid)
        RETURNING token::text AS token
      `;
      token = invRows[0].token;
    } catch (err) {
      await prisma.$executeRaw`DELETE FROM deals WHERE id = ${dealId}::uuid`.catch(
        () => {}
      );
      throw err;
    }

    const url = new URL(req.url);
    const origin = `${url.protocol}//${url.host}`;
    const inviteUrl = `${origin}/invite/${token}`;

    // Best-effort: email the client their invite. A delivery failure must never
    // fail the response — swallow + log and still return 200.
    try {
      await sendInviteEmail({
        to: body.email,
        name: body.name,
        dealTitle:
          body.role === "seller" ? "your home sale" : "your home search",
        inviteUrl,
      });
    } catch (err) {
      console.error("failed to send client invite email", err);
    }

    return json({ ok: true, inviteUrl, dealId });
  })) as Response;
}
