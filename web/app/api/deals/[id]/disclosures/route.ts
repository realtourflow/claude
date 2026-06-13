import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { hasRole } from "@/lib/roles";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/deals/[id]/disclosures — record disclosure completion.
//
// RTF never SENDS disclosures: the lender delivers them out-of-band and RTF
// tracks where they stand. This manual setter (agent owner / TC / admin) is
// the v1 source; the ARIVE sync will call the same update with
// source='arive' when it lands (v2) — keep that seam in mind before
// reshaping this route.
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    // TC/admin may update any deal; agents only their own.
    if (!hasRole(claims.roles, ["tc", "admin"])) {
      const owned = await prisma.deals.findFirst({
        where: { id: dealId, agent_id: userId },
        select: { id: true },
      });
      if (!owned) return error("deal not found or access denied", 404);
    }

    let body: { complete?: boolean };
    try {
      body = (await req.json()) as { complete?: boolean };
    } catch {
      return error("complete (boolean) required", 400);
    }
    if (typeof body.complete !== "boolean") {
      return error("complete (boolean) required", 400);
    }

    const updated = await prisma.deals.update({
      where: { id: dealId },
      data: {
        disclosures_complete: body.complete,
        disclosures_source: "manual",
        disclosures_updated_at: new Date(),
        updated_at: new Date(),
      },
      select: {
        disclosures_complete: true,
        disclosures_source: true,
        disclosures_updated_at: true,
      },
    });
    return json(updated);
  })) as Response;
}
