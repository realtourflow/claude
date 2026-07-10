import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { hasDealAccess } from "@/lib/deals";

type Ctx = { params: Promise<{ id: string }> };

type PropertyRow = Awaited<
  ReturnType<typeof prisma.tracked_properties.findMany>
>[number];

/**
 * Wire serializer for tracked_properties. `agent_private_note` is labeled
 * "only you see this" in the agent UI — it must never reach non-owner
 * callers (buyers/sellers are deal participants and pass hasDealAccess).
 */
function serializeProperty(row: PropertyRow, includeAgentPrivate: boolean) {
  const { agent_private_note, ...shared } = row;
  return includeAgentPrivate ? { ...shared, agent_private_note } : shared;
}

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    if (!(await hasDealAccess(dealId, userId))) return error("deal not found", 404);
    const deal = await prisma.deals.findUnique({
      where: { id: dealId },
      select: { agent_id: true },
    });
    const isOwningAgent = deal?.agent_id === userId;
    const rows = await prisma.tracked_properties.findMany({
      where: { deal_id: dealId },
      orderBy: { created_at: "desc" },
    });
    return json(rows.map((row) => serializeProperty(row, isOwningAgent)));
  })) as Response;
}

type CreateBody = {
  address?: string;
  city?: string;
  state?: string;
  price?: number;
  beds?: number;
  baths?: number;
  sqft?: number;
  thumbnail_url?: string;
  source_url?: string;
  status?: string;
  /** Accepted from the client but IGNORED — added_by is derived server-side. */
  added_by?: string;
  /** Agent-only: a non-owner sending this gets a 403. */
  agent_note?: string | null;
  buyer_note?: string | null;
};

/**
 * Create a tracked property. #168: the owning agent AND deal participants
 * (buyers/sellers) may add properties — the buyer portal's home-search card
 * drives this as a participant. `added_by` is derived from the caller's role
 * on the deal (never trusted from the body); `agent_note` stays agent-only.
 */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    if (!(await hasDealAccess(dealId, userId))) return error("deal not found", 404);
    const deal = await prisma.deals.findUnique({
      where: { id: dealId },
      select: { agent_id: true },
    });
    const isOwningAgent = deal?.agent_id === userId;

    let body: CreateBody;
    try {
      body = (await req.json()) as CreateBody;
    } catch {
      return error("invalid request body", 400);
    }
    if (!body.address) return error("address is required", 400);
    if (!isOwningAgent && body.agent_note != null)
      return error("agent_note is agent-only", 403);

    // Derive added_by from the caller's role on the deal: the owning agent is
    // "agent"; anyone else with access is a participant (buyer/seller/…).
    let addedBy = "agent";
    if (!isOwningAgent) {
      const participant = await prisma.deal_participants.findFirst({
        where: { deal_id: dealId, user_id: userId },
        select: { role: true },
      });
      addedBy = participant?.role ?? "buyer";
    }

    const row = await prisma.tracked_properties.create({
      data: {
        deal_id: dealId,
        address: body.address,
        city: body.city ?? "",
        state: body.state ?? "",
        price: body.price ?? 0,
        beds: body.beds ?? 0,
        baths: body.baths ?? 0,
        sqft: body.sqft ?? 0,
        thumbnail_url: body.thumbnail_url ?? "",
        source_url: body.source_url ?? "",
        status: body.status ?? "interested",
        added_by: addedBy,
        agent_note: isOwningAgent ? (body.agent_note ?? null) : null,
        buyer_note: body.buyer_note ?? null,
      },
    });
    return json(serializeProperty(row, isOwningAgent), 201);
  })) as Response;
}
