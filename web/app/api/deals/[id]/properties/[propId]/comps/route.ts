/**
 * GET /deals/:dealId/properties/:propId/comps — comparable-sales analysis for a
 * tracked property (#374).
 *
 * OWNING AGENT ONLY. Unlike the listing search (which any deal participant may
 * call), comps and the derived price range are never exposed to buyers/sellers:
 * the agent is the MLS licensee, and MLS/IDX terms restrict sold data and
 * derived valuations reaching consumers. Product decision, Paul 2026-07-23.
 *
 * Runs on the deal agent's own stored MLS credentials, same as the search route
 * (503 when they haven't connected MLS, 502 when SimplyRETS is failing).
 *
 * Stateless by design — nothing is persisted. Caching/spend controls belong to
 * the cost-guardrails ticket (#377).
 */
import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { getSimplyretsClient } from "@/lib/simplyrets";
import { decryptField } from "@/lib/crypto";
import {
  analyzeComps,
  COMP_TIERS,
  MAX_COMPS,
  type CompCandidate,
  type CompSubject,
} from "@/lib/comps";
import type { MLSListing } from "@/hooks/useMLS";

type Ctx = { params: Promise<{ id: string; propId: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * How many closed listings to pull. The widening ladder runs locally, so we
 * fetch ONE superset bracketed by the widest tier and let analyzeComps narrow
 * it — rather than making a round trip per tier.
 */
const FETCH_LIMIT = 100;

const WIDEST = COMP_TIERS[COMP_TIERS.length - 1];

function toCandidate(l: MLSListing): CompCandidate {
  return {
    mlsId: l.mlsId,
    address: l.address.full,
    city: l.address.city,
    // Listings with no sale price are dropped by analyzeComps.
    closePrice: l.sales?.closePrice ?? 0,
    closeDate: l.sales?.closeDate ?? "",
    beds: l.property.bedrooms,
    baths: l.property.bathsFull,
    sqft: l.property.area,
  };
}

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId, propId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    if (!UUID_RE.test(dealId) || !UUID_RE.test(propId)) {
      return error("deal not found", 404);
    }

    // Owning agent only — participants get the same 404 as a stranger, so the
    // route never even confirms the deal exists to a buyer.
    const deal = await prisma.deals.findFirst({
      where: { id: dealId, agent_id: userId },
      select: { agent_id: true },
    });
    if (!deal) return error("deal not found", 404);

    const property = await prisma.tracked_properties.findFirst({
      where: { id: propId, deal_id: dealId },
      select: { id: true, address: true, city: true, state: true, beds: true, baths: true, sqft: true },
    });
    if (!property) return error("property not found", 404);

    if (!property.city.trim()) {
      // City is how comps are scoped — without it there is nothing to search.
      return error("property has no city to search comps in", 422);
    }

    const agent = await prisma.users.findUnique({
      where: { id: deal.agent_id },
      select: { mls_key: true, mls_secret: true },
    });
    if (!agent?.mls_key) return error("agent has not connected MLS", 503);

    const subject: CompSubject = {
      city: property.city,
      beds: Number(property.beds),
      baths: Number(property.baths),
      sqft: property.sqft,
    };

    // Bracket the pull with the WIDEST tier so one fetch feeds every rung.
    const mlsKey = decryptField(agent.mls_key);
    const mlsSecret = agent.mls_secret ? decryptField(agent.mls_secret) : "";

    let listings: MLSListing[];
    try {
      listings = await getSimplyretsClient().search(mlsKey, mlsSecret, {
        cities: [subject.city],
        status: "Closed",
        limit: FETCH_LIMIT,
        ...(subject.beds > 0
          ? {
              minBeds: Math.max(0, subject.beds - WIDEST.bedsDelta),
              maxBeds: subject.beds + WIDEST.bedsDelta,
            }
          : {}),
        ...(subject.sqft > 0
          ? {
              minArea: subject.sqft * (1 - WIDEST.sqftPct),
              maxArea: subject.sqft * (1 + WIDEST.sqftPct),
            }
          : {}),
      });
    } catch (e) {
      // Bad creds and outages both surface as 502 here, matching the search
      // route's contract (#309 keeps them distinguishable upstream).
      const msg = e instanceof Error ? e.message : String(e);
      return error(msg, 502);
    }

    const analysis = analyzeComps(listings.map(toCandidate), subject);

    return json({
      subject: {
        id: property.id,
        address: property.address,
        city: property.city,
        state: property.state,
        beds: subject.beds,
        baths: subject.baths,
        sqft: subject.sqft,
      },
      range: analysis.range,
      basis: analysis.basis,
      median_price_per_sqft: analysis.median_price_per_sqft,
      comps: analysis.comps,
      comp_count: analysis.comps.length,
      max_comps: MAX_COMPS,
      tier_used: analysis.tier_used,
      widened: analysis.widened,
      reason: analysis.reason,
      disclaimer: analysis.disclaimer,
    });
  })) as Response;
}
