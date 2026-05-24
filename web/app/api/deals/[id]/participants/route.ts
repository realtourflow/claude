import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";

type Ctx = { params: Promise<{ id: string }> };

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

type AddBody = { user_id?: string; role?: string };

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
      return error("user_id and role are required", 400);
    }
    if (!body.user_id || !body.role) {
      return error("user_id and role are required", 400);
    }

    await prisma.$executeRaw`
      INSERT INTO deal_participants (deal_id, user_id, role)
      VALUES (${dealId}::uuid, ${body.user_id}::uuid, ${body.role})
      ON CONFLICT (deal_id, user_id) DO UPDATE SET role = EXCLUDED.role
    `;
    return json({ status: "ok" });
  })) as Response;
}
