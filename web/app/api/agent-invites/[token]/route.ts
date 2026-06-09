import { error, json } from "@/lib/http";
import { prisma } from "@/lib/db";

type Ctx = { params: Promise<{ token: string }> };

type Row = {
  id: string;
  email: string;
  name: string;
  token: string;
  invited_by: string;
  claimed_at: Date | null;
  expires_at: Date;
  created_at: Date;
};

// GET — public (no auth); validates an agent invite token for the
// /agent-signup/[token] landing page.
// Mirrors GetAgentInvite in backend/internal/handlers/agent_invites.go.
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { token } = await ctx.params;

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT id, email, name, token::text AS token, invited_by::text AS invited_by,
           claimed_at, expires_at, created_at
    FROM agent_invites
    WHERE token = ${token}::uuid
  `;
  const row = rows[0];
  if (!row) return error("invite not found", 404);

  const claimed = row.claimed_at !== null;
  if (row.expires_at < new Date() && !claimed) {
    return error("invite expired", 410);
  }

  return json({
    id: row.id,
    email: row.email,
    name: row.name,
    token: row.token,
    invited_by: row.invited_by,
    claimed,
    expires_at: row.expires_at.toISOString(),
    created_at: row.created_at.toISOString(),
  });
}
