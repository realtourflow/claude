import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/roles";

type Ctx = { params: Promise<{ inviteId: string }> };

// DELETE — admin only; revokes an unclaimed invite.
// Mirrors DeleteAgentInvite in backend/internal/handlers/agent_invites.go.
export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const { inviteId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    if (!hasRole(claims.roles, ["admin"])) return error("forbidden", 403);

    const affected = await prisma.$executeRaw`
      DELETE FROM agent_invites
      WHERE id = ${inviteId}::uuid AND claimed_at IS NULL
    `;
    if (affected === 0) {
      return error("invite not found or already claimed", 404);
    }
    return json({ ok: true });
  })) as Response;
}
