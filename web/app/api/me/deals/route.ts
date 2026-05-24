import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db";
import { error, json, withAuth } from "@/lib/http";
import { resolveUserId } from "@/lib/users";
import { healthExpr } from "@/lib/deals";

// GET /api/me/deals — deals where the caller is a participant.
export async function GET(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    void Prisma; // ensure import remains for $queryRaw types

    const rows = await prisma.$queryRaw<
      {
        id: string;
        agent_id: string;
        type: string;
        stage: string;
        health: string;
        title: string;
        address: string | null;
        price: string | null;
        arive_linked: boolean;
        created_at: Date;
        updated_at: Date;
        agent_name: string;
        agent_email: string;
        agent_phone: string | null;
      }[]
    >`
      SELECT deals.id, deals.agent_id, deals.type::text AS type, deals.stage::text AS stage,
             ${healthExpr} AS health,
             deals.title, deals.address, deals.price::text AS price,
             deals.arive_linked, deals.created_at, deals.updated_at,
             u.name AS agent_name, u.email AS agent_email, u.phone AS agent_phone
      FROM deals
      JOIN deal_participants dp ON dp.deal_id = deals.id AND dp.user_id = ${userId}::uuid
      JOIN users u ON u.id = deals.agent_id
      ORDER BY deals.updated_at DESC
    `;
    return json(rows);
  })) as Response;
}
