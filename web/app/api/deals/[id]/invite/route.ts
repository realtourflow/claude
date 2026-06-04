import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { hasRole } from "@/lib/roles";
import { sendInviteEmail } from "@/lib/email";

type Ctx = { params: Promise<{ id: string }> };

type CreateInviteBody = {
  email?: string;
  name?: string;
  role?: "buyer" | "seller";
};

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const isAgent = hasRole(claims.roles, ["agent"]);
    const isAdmin = hasRole(claims.roles, ["admin"]);
    if (!isAgent && !isAdmin) return error("forbidden", 403);

    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);

    // Agents can only invite to their own deals.
    if (!isAdmin) {
      const deal = await prisma.deals.findFirst({
        where: { id: dealId, agent_id: userId },
        select: { id: true },
      });
      if (!deal) return error("forbidden", 403);
    }

    let body: CreateInviteBody;
    try {
      body = (await req.json()) as CreateInviteBody;
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

    const rows = await prisma.$queryRaw<
      {
        id: string;
        deal_id: string;
        email: string;
        name: string;
        role: string;
        token: string;
        expires_at: Date;
      }[]
    >`
      INSERT INTO deal_invites (deal_id, email, name, role, invited_by)
      VALUES (${dealId}::uuid, ${body.email}, ${body.name},
              ${body.role}, ${userId}::uuid)
      RETURNING id, deal_id, email, name, role, token::text AS token, expires_at
    `;
    const inv = rows[0];

    // Best-effort: email the invitee their link. A delivery failure must never
    // block invite creation — swallow + log and still return 201.
    try {
      const dealRow = await prisma.deals.findUnique({
        where: { id: dealId },
        select: { title: true },
      });
      const url = new URL(req.url);
      const origin = `${url.protocol}//${url.host}`;
      await sendInviteEmail({
        to: inv.email,
        name: inv.name,
        dealTitle: dealRow?.title ?? "your deal",
        inviteUrl: `${origin}/invite/${inv.token}`,
      });
    } catch (err) {
      console.error("failed to send invite email", err);
    }

    return json(
      { ...inv, expires_at: inv.expires_at.toISOString() },
      201
    );
  })) as Response;
}
