import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { hasRole } from "@/lib/roles";
import { sendAgentInviteEmail } from "@/lib/email";

type AgentInviteRow = {
  id: string;
  email: string;
  name: string;
  token: string;
  invited_by: string;
  claimed_at: Date | null;
  expires_at: Date;
  created_at: Date;
};

type CreateBody = {
  email?: string;
  name?: string;
};

// GET — admin only; lists the 100 most recent agent invites.
// Mirrors ListAgentInvites in the legacy Go backend.
export async function GET(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    if (!hasRole(claims.roles, ["admin"])) return error("forbidden", 403);

    const rows = await prisma.$queryRaw<AgentInviteRow[]>`
      SELECT id, email, name, token::text AS token, invited_by::text AS invited_by,
             claimed_at, expires_at, created_at
      FROM agent_invites
      ORDER BY created_at DESC
      LIMIT 100
    `;

    return json(
      rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        token: r.token,
        invited_by: r.invited_by,
        claimed: r.claimed_at !== null,
        expires_at: r.expires_at.toISOString(),
        created_at: r.created_at.toISOString(),
      }))
    );
  })) as Response;
}

// POST — admin only; creates an invite and fires a best-effort signup email.
// Mirrors CreateAgentInvite in the legacy Go backend.
export async function POST(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    if (!hasRole(claims.roles, ["admin"])) return error("forbidden", 403);

    const adminId = await resolveUserId(claims.sub);
    if (!adminId) return error("user not found", 401);

    let body: CreateBody;
    try {
      body = (await req.json()) as CreateBody;
    } catch {
      return error("email is required", 400);
    }
    if (!body.email) return error("email is required", 400);

    const rows = await prisma.$queryRaw<AgentInviteRow[]>`
      INSERT INTO agent_invites (email, name, invited_by)
      VALUES (${body.email}, ${body.name ?? ""}, ${adminId}::uuid)
      RETURNING id, email, name, token::text AS token, invited_by::text AS invited_by,
                claimed_at, expires_at, created_at
    `;
    const inv = rows[0];

    // Best-effort: email the invitee their signup link. A delivery failure must
    // never block invite creation — swallow + log and still return 201.
    try {
      const url = new URL(req.url);
      const origin = `${url.protocol}//${url.host}`;
      await sendAgentInviteEmail({
        to: inv.email,
        name: inv.name,
        inviteUrl: `${origin}/agent-signup/${inv.token}`,
      });
    } catch (err) {
      console.error("failed to send agent invite email", err);
    }

    return json(
      {
        id: inv.id,
        email: inv.email,
        name: inv.name,
        token: inv.token,
        invited_by: inv.invited_by,
        claimed: inv.claimed_at !== null,
        expires_at: inv.expires_at.toISOString(),
        created_at: inv.created_at.toISOString(),
      },
      201
    );
  })) as Response;
}
