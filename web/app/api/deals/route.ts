import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db";
import { error, json, withAuth } from "@/lib/http";
import { hasRole } from "@/lib/roles";
import { resolveUserId } from "@/lib/users";
import { listDealsForUser } from "@/lib/deals";
import { createDealBodySchema, DEAL_STATUSES } from "@/lib/schemas/deal";
import { parseBody } from "@/lib/schemas/parse";

export async function GET(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found — call /users/sync first", 404);
    // Default pipeline hides non-active deals (#254). `?status=` overrides:
    // a valid lifecycle status shows only that; `?status=all` shows every
    // status. An unrecognized value falls back to the active-only default.
    const requested = new URL(req.url).searchParams.get("status");
    const statusFilter =
      requested === "all" || (DEAL_STATUSES as readonly string[]).includes(requested ?? "")
        ? (requested as string)
        : undefined;
    const deals = await listDealsForUser(userId, {
      isAdmin: hasRole(claims.roles, ["admin"]),
      isTC: hasRole(claims.roles, ["tc"]),
      statusFilter,
    });
    return json(deals);
  })) as Response;
}

export async function POST(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    // Deal creation is restricted to agents (and admins). Every other role
    // (buyer/seller/tc/lending_partner) would otherwise create a deal owned
    // by themselves as agent_id. Reject before doing any work (#274). Client
    // deals are created via the invite flow, not this endpoint.
    if (!hasRole(claims.roles, ["agent", "admin"])) {
      return error("only agents can create deals", 403);
    }

    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found — call /users/sync first", 404);

    const parsed = await parseBody(req, createDealBodySchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
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
        closing_date: string | null;
        created_at: Date;
        updated_at: Date;
      }[]
    >`
      INSERT INTO deals (agent_id, type, title, address, price, arive_linked, closing_date, market)
      VALUES (${userId}::uuid, ${type}::deal_type, ${title},
              ${body.address ?? null},
              ${body.price ?? null}::decimal,
              ${body.arive_linked ?? false},
              ${body.closing_date ?? null}::date,
              COALESCE((SELECT market FROM users WHERE id = ${userId}::uuid), ''))
      RETURNING id, agent_id, type::text AS type, stage::text AS stage,
                title, address, price::text AS price, arive_linked,
                closing_date::text AS closing_date, created_at, updated_at
    `;
    return json({ ...rows[0], health: "green" }, 201);
  })) as Response;
}

// Make eslint happy about Prisma import (used for Prisma.sql in deals.ts).
export const _unused = Prisma;
