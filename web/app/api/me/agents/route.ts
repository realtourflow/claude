/**
 * /me/agents — the agents who have the calling TC assigned as their TC.
 *
 * Ports ListMyAgents in the legacy Go backend: every users row whose
 * tc_user_id equals the caller, with a count of that agent's active deals.
 *
 * DEVIATION FROM THE GO SOURCE: the Go query counts
 *   COUNT(d.id) FILTER (WHERE d.status = 'active')
 * but `deals` has no `status` column in any migration (000001 onward) — deals
 * track lifecycle via the `stage` enum (intake → post_close), not a status. The
 * Go query references a nonexistent column. Here "active" is interpreted as the
 * agent's open pipeline: deals not yet closed out, i.e. stage <> 'post_close'.
 * The response shape (active_deal_count) is unchanged and matches ApiAgentSummary.
 */
import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";

type ApiAgentSummary = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  active_deal_count: number;
};

type AgentRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  active_deal_count: bigint;
};

export async function GET(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    const rows = await prisma.$queryRaw<AgentRow[]>`
      SELECT
        u.id,
        u.name,
        u.email,
        u.phone,
        COUNT(d.id) FILTER (WHERE d.stage <> 'post_close') AS active_deal_count
      FROM users u
      LEFT JOIN deals d ON d.agent_id = u.id
      WHERE u.tc_user_id = ${userId}::uuid
      GROUP BY u.id, u.name, u.email, u.phone
      ORDER BY u.name
    `;

    const agents: ApiAgentSummary[] = rows.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      phone: a.phone,
      // COUNT returns bigint over the pg driver; ApiAgentSummary wants a number.
      active_deal_count: Number(a.active_deal_count),
    }));
    return json(agents);
  })) as Response;
}
