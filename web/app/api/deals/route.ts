import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db";
import { error, json, withAuth } from "@/lib/http";
import { hasRole } from "@/lib/roles";
import { resolveUserId } from "@/lib/users";
import { listDealsForUser } from "@/lib/deals";

export async function GET(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found — call /users/sync first", 404);
    const isTCOrAdmin = hasRole(claims.roles, ["tc", "admin"]);
    const deals = await listDealsForUser(userId, isTCOrAdmin);
    return json(deals);
  })) as Response;
}

type CreateBody = {
  title?: string;
  type?: string;
  address?: string | null;
  price?: number | null;
  arive_linked?: boolean;
};

export async function POST(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found — call /users/sync first", 404);

    let body: CreateBody;
    try {
      body = (await req.json()) as CreateBody;
    } catch {
      return error("invalid request body", 400);
    }
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const type = body.type;
    if (!title || (type !== "buy" && type !== "sell")) {
      return error("title and type (buy|sell) are required", 400);
    }

    const rows = await prisma.$queryRaw<
      {
        id: string;
        agent_id: string;
        type: string;
        stage: string;
        title: string;
        address: string | null;
        price: string | null;
        arive_linked: boolean;
        created_at: Date;
        updated_at: Date;
      }[]
    >`
      INSERT INTO deals (agent_id, type, title, address, price, arive_linked, market)
      VALUES (${userId}::uuid, ${type}::deal_type, ${title},
              ${body.address ?? null},
              ${body.price ?? null}::decimal,
              ${body.arive_linked ?? false},
              COALESCE((SELECT market FROM users WHERE id = ${userId}::uuid), ''))
      RETURNING id, agent_id, type::text AS type, stage::text AS stage,
                title, address, price::text AS price, arive_linked, created_at, updated_at
    `;
    return json({ ...rows[0], health: "green" }, 201);
  })) as Response;
}

// Make eslint happy about Prisma import (used for Prisma.sql in deals.ts).
export const _unused = Prisma;
