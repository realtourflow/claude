import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { upsertUser } from "@/lib/users";
import type { Role } from "@/lib/roles";

type Ctx = { params: Promise<{ token: string }> };

type ClaimBody = { email?: string; name?: string };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { token } = await ctx.params;
  // JWT required but no role claim required — invitee may not have one yet.
  return (await withAuth(req, async (claims): Promise<Response> => {
    let body: ClaimBody;
    try {
      body = (await req.json()) as ClaimBody;
    } catch {
      return error("invalid request body", 400);
    }
    if (!body.email || !body.name) {
      return error("email and name are required", 400);
    }

    const invites = await prisma.$queryRaw<
      {
        id: string;
        deal_id: string;
        role: Role;
        claimed_at: Date | null;
        expires_at: Date;
      }[]
    >`
      SELECT id, deal_id, role::text AS role, claimed_at, expires_at
      FROM deal_invites
      WHERE token = ${token}::uuid AND email = ${body.email}
    `;
    const inv = invites[0];
    if (!inv) return error("invite not found", 404);
    if (inv.claimed_at !== null) return error("invite already claimed", 409);
    if (inv.expires_at.getTime() < Date.now()) return error("invite expired", 410);

    const user = await upsertUser({
      auth0Id: claims.sub,
      email: body.email,
      name: body.name,
      role: inv.role,
    });

    await prisma.deal_invites.update({
      where: { id: inv.id },
      data: { claimed_at: new Date(), claimed_by: user.id },
    });

    // Link the user as a deal participant (idempotent).
    await prisma.$executeRaw`
      INSERT INTO deal_participants (deal_id, user_id, role)
      VALUES (${inv.deal_id}::uuid, ${user.id}::uuid, ${inv.role})
      ON CONFLICT DO NOTHING
    `;

    return json(user);
  })) as Response;
}
