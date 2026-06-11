import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { upsertUser } from "@/lib/users";

type Ctx = { params: Promise<{ token: string }> };

type ClaimBody = {
  email?: string;
  name?: string;
};

type InviteRow = {
  id: string;
  email: string;
  claimed_at: Date | null;
  expires_at: Date;
};

// POST — JWT required (any role); creates the agent user and marks the invite
// claimed. Mirrors ClaimAgentInvite in the legacy Go backend.
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { token } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    let body: ClaimBody;
    try {
      body = (await req.json()) as ClaimBody;
    } catch {
      return error("invalid request body", 400);
    }

    const rows = await prisma.$queryRaw<InviteRow[]>`
      SELECT id, email, claimed_at, expires_at
      FROM agent_invites
      WHERE token = ${token}::uuid
    `;
    const invite = rows[0];
    if (!invite) return error("invite not found", 404);
    if (invite.claimed_at !== null) return error("invite already claimed", 409);
    if (invite.expires_at < new Date()) return error("invite expired", 410);

    // Fall back to the invited email/name when the request omits them.
    const claimEmail = body.email || invite.email;
    const claimName = body.name || invite.email;

    const user = await upsertUser({
      auth0Id: claims.sub,
      email: claimEmail,
      name: claimName,
      role: "agent",
    });

    await prisma.$executeRaw`
      UPDATE agent_invites
      SET claimed_at = NOW(), claimed_by = ${user.id}::uuid
      WHERE id = ${invite.id}::uuid
    `;

    return json(user);
  })) as Response;
}
