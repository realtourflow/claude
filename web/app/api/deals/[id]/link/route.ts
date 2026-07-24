import { Prisma } from "@/app/generated/prisma/client";
import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { hasDealAccess } from "@/lib/deals";

type Ctx = { params: Promise<{ id: string }> };

type DealLinkRow = Awaited<ReturnType<typeof prisma.deal_links.findFirst>>;

/**
 * Minimal counterpart-deal summary carried alongside a bridge link — enough for
 * the coordination UI (#381) to render "the other side" without a second fetch.
 * `closing_date` is the shared-timeline anchor (the sell must close to retire
 * the bridge); serialized as `YYYY-MM-DD` text like the rest of the app (#253).
 */
type CounterpartSummary = {
  id: string;
  type: string;
  stage: string;
  title: string;
  address: string | null;
  closing_date: string | null;
  status: string;
};

async function counterpartSummary(
  dealId: string
): Promise<CounterpartSummary | null> {
  const rows = await prisma.$queryRaw<CounterpartSummary[]>`
    SELECT id, type::text AS type, stage::text AS stage, title, address,
           closing_date::text AS closing_date, status
    FROM deals
    WHERE id = ${dealId}::uuid
  `;
  return rows[0] ?? null;
}

/**
 * Serialize a link relative to the deal it's being viewed from: `this_side`
 * tells the caller whether the current deal is the buy or sell leg, and
 * `counterpart` summarizes the OTHER deal. The stored orientation
 * (buy_deal_id / sell_deal_id) is always returned verbatim so it never depends
 * on which side you asked from.
 */
async function serializeLinkForDeal(link: NonNullable<DealLinkRow>, dealId: string) {
  const isBuySide = link.buy_deal_id === dealId;
  const counterpartId = isBuySide ? link.sell_deal_id : link.buy_deal_id;
  return {
    id: link.id,
    buy_deal_id: link.buy_deal_id,
    sell_deal_id: link.sell_deal_id,
    agent_id: link.agent_id,
    created_at: link.created_at,
    this_side: isBuySide ? "buy" : "sell",
    counterpart: await counterpartSummary(counterpartId),
  };
}

/** The bridge link this deal participates in, on either leg (at most one). */
function findLinkForDeal(dealId: string) {
  return prisma.deal_links.findFirst({
    where: { OR: [{ buy_deal_id: dealId }, { sell_deal_id: dealId }] },
  });
}

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    // Read is open to anyone on the deal (agent owner or participant) — the
    // buyer/seller portals can surface "your other transaction".
    if (!(await hasDealAccess(dealId, userId))) return error("deal not found", 404);

    const link = await findLinkForDeal(dealId);
    if (!link) return json({ link: null });
    return json({ link: await serializeLinkForDeal(link, dealId) });
  })) as Response;
}

type CreateBody = { counterpart_deal_id?: string };

/**
 * Create the bridge link between this deal and a counterpart. The owning agent
 * must own BOTH deals, and the two must be opposite types (one buy, one sell) —
 * the orientation is derived from `deals.type`, never trusted from the body.
 * Same-client is intentionally NOT enforced (agent asserts the pairing; #378).
 * A deal already in a bridge on either leg → 409.
 */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    let body: CreateBody;
    try {
      body = (await req.json()) as CreateBody;
    } catch {
      return error("invalid request body", 400);
    }
    const counterpartId = body.counterpart_deal_id;
    if (!counterpartId) return error("counterpart_deal_id is required", 400);
    if (counterpartId === dealId)
      return error("a deal cannot be linked to itself", 400);

    // The caller must own BOTH deals. Fetching with agent_id scoping means a
    // deal the agent doesn't own simply won't come back → count < 2 → 404.
    const deals = await prisma.deals.findMany({
      where: { id: { in: [dealId, counterpartId] }, agent_id: userId },
      select: { id: true, type: true },
    });
    if (deals.length !== 2) return error("deal not found", 404);

    const typeById = new Map(deals.map((d) => [d.id, d.type as string]));
    const thisType = typeById.get(dealId);
    const otherType = typeById.get(counterpartId);
    if (!(thisType === "buy" && otherType === "sell") &&
        !(thisType === "sell" && otherType === "buy")) {
      return error("a bridge links one buy deal to one sell deal", 400);
    }

    const buyDealId = thisType === "buy" ? dealId : counterpartId;
    const sellDealId = thisType === "sell" ? dealId : counterpartId;

    // Pre-check for a clean 409 (a friendlier message than the raw unique
    // violation); the unique constraints below are the real guarantee and also
    // close the check-then-insert race.
    const clash = await prisma.deal_links.findFirst({
      where: {
        OR: [
          { buy_deal_id: dealId },
          { sell_deal_id: dealId },
          { buy_deal_id: counterpartId },
          { sell_deal_id: counterpartId },
        ],
      },
      select: { id: true },
    });
    if (clash) return error("one of these deals is already bridge-linked", 409);

    try {
      const link = await prisma.deal_links.create({
        data: { buy_deal_id: buyDealId, sell_deal_id: sellDealId, agent_id: userId },
      });
      return json(await serializeLinkForDeal(link, dealId), 201);
    } catch (err) {
      // Unique-constraint violation from a concurrent insert → 409, not 500.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        return error("one of these deals is already bridge-linked", 409);
      }
      throw err;
    }
  })) as Response;
}

/**
 * Remove this deal's bridge link. Owning-agent only; idempotent (deleting when
 * there is no link still 204s). Scoping the delete to a deal the caller owns
 * means an agent can never sever another agent's bridge.
 */
export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    const owned = await prisma.deals.findFirst({
      where: { id: dealId, agent_id: userId },
      select: { id: true },
    });
    if (!owned) return error("deal not found", 404);

    await prisma.deal_links.deleteMany({
      where: { OR: [{ buy_deal_id: dealId }, { sell_deal_id: dealId }] },
    });
    return new Response(null, { status: 204 });
  })) as Response;
}
