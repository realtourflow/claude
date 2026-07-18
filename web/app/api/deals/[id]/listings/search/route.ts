/**
 * GET /deals/:dealId/listings/search — proxies a SimplyRETS listing search
 * using the DEAL'S AGENT credentials (not the caller's). Mirrors SearchListings
 * in the legacy Go backend.
 *
 * Any participant (agent owner or buyer/seller on the deal) may call it, but the
 * search always runs against the deal agent's stored MLS key/secret. If the
 * agent has not connected MLS we return 503, matching the Go handler.
 *
 * Returns MLSListing[] (see hooks/useMLS.ts).
 */
import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { hasDealAccess } from "@/lib/deals";
import { getSimplyretsClient, type SearchParams } from "@/lib/simplyrets";
import { decryptField } from "@/lib/crypto";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    const access = await hasDealAccess(dealId, userId);
    if (!access) return error("deal not found", 404);

    // The search runs against the deal agent's MLS credentials.
    const deal = await prisma.deals.findUnique({
      where: { id: dealId },
      select: { agent_id: true },
    });
    if (!deal) return error("deal not found", 404);

    const agent = await prisma.users.findUnique({
      where: { id: deal.agent_id },
      select: { mls_key: true, mls_secret: true },
    });
    if (!agent?.mls_key) {
      return error("agent has not connected MLS", 503);
    }

    const params = parseSearchParams(new URL(req.url).searchParams);

    // Decrypt the stored MLS creds before authenticating to SimplyRETS (#273).
    // decryptField transparently passes legacy plaintext rows through unchanged,
    // so pre-encryption creds keep working until the agent next re-saves.
    const mlsKey = decryptField(agent.mls_key);
    const mlsSecret = agent.mls_secret ? decryptField(agent.mls_secret) : "";

    let listings;
    try {
      listings = await getSimplyretsClient().search(
        mlsKey,
        mlsSecret,
        params
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return error(msg, 502);
    }

    return json(listings);
  })) as Response;
}

// Parse the query string useMLS sends: minprice, maxprice, cities (repeated),
// minbeds — plus the city/status/limit fallbacks the Go handler accepts.
function parseSearchParams(q: URLSearchParams): SearchParams {
  const params: SearchParams = { limit: 12 };

  const minprice = q.get("minprice");
  if (minprice) params.minPrice = parseInt(minprice, 10) || 0;

  const maxprice = q.get("maxprice");
  if (maxprice) params.maxPrice = parseInt(maxprice, 10) || 0;

  const minbeds = q.get("minbeds");
  if (minbeds) params.minBeds = parseInt(minbeds, 10) || 0;

  const cities = q.getAll("cities");
  if (cities.length > 0) {
    params.cities = cities;
  } else {
    const city = q.get("city");
    if (city) params.cities = [city];
  }

  const status = q.get("status");
  if (status) params.status = status;

  const limit = q.get("limit");
  if (limit) {
    const n = parseInt(limit, 10);
    if (!Number.isNaN(n) && n > 0 && n <= 50) params.limit = n;
  }

  return params;
}
