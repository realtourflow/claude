import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";

type Ctx = { params: Promise<{ id: string }> };

// Valid participant roles — mirrors the user_role enum on deal_participants.role
// (see backend/migrations/000001_init.up.sql + 000006_add_tc_role.up.sql).
const PARTICIPANT_ROLES = [
  "agent",
  "buyer",
  "seller",
  "admin",
  "tc",
  "lending_partner",
] as const;

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    const access = await prisma.deals.findFirst({
      where: {
        id: dealId,
        OR: [
          { agent_id: userId },
          { deal_participants: { some: { user_id: userId } } },
        ],
      },
      select: { id: true },
    });
    if (!access) return error("deal not found", 404);

    const rows = await prisma.$queryRaw<
      {
        id: string;
        name: string;
        email: string;
        phone: string | null;
        role: string;
      }[]
    >`
      SELECT u.id, u.name, u.email, u.phone, dp.role
      FROM deal_participants dp
      JOIN users u ON u.id = dp.user_id
      WHERE dp.deal_id = ${dealId}::uuid
      ORDER BY u.name
    `;
    return json(rows);
  })) as Response;
}

// Accepts either { user_id, role } (back-compat) or { email, role }. When an
// email is supplied (and no user_id), we resolve it to an EXISTING RealTourFlow
// user case-insensitively. No match → 404 so the UI can steer the agent toward
// the invite flow.
type AddBody = { user_id?: string; role?: string; email?: string };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    const deal = await prisma.deals.findFirst({
      where: { id: dealId, agent_id: userId },
      select: { id: true },
    });
    if (!deal) return error("deal not found", 404);

    let body: AddBody;
    try {
      body = (await req.json()) as AddBody;
    } catch {
      return error("user_id or email, plus role, are required", 400);
    }

    const role = body.role;
    if (!role || !(PARTICIPANT_ROLES as readonly string[]).includes(role)) {
      return error(
        `role is required and must be one of: ${PARTICIPANT_ROLES.join(", ")}`,
        400
      );
    }

    // Resolve the target user id from either user_id or email.
    let targetUserId = body.user_id;
    if (!targetUserId) {
      if (!body.email) {
        return error("user_id or email is required", 400);
      }
      const found = await prisma.users.findFirst({
        where: { email: { equals: body.email.trim(), mode: "insensitive" } },
        select: { id: true },
      });
      if (!found) {
        return error(
          "No RealTourFlow account with that email — invite them first.",
          404
        );
      }
      targetUserId = found.id;
    }

    await prisma.$executeRaw`
      INSERT INTO deal_participants (deal_id, user_id, role)
      VALUES (${dealId}::uuid, ${targetUserId}::uuid, ${role})
      ON CONFLICT (deal_id, user_id) DO UPDATE SET role = EXCLUDED.role
    `;
    return json({ status: "ok" });
  })) as Response;
}
