import { json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";

// GET /api/brokerages — the ACTIVE company list for the profile/onboarding
// dropdown. Agent-suggested ("Other") names stay pending until the admin
// approves them into this list.
export async function GET(req: Request): Promise<Response> {
  return (await withAuth(
    req,
    async (): Promise<Response> => {
      const rows = await prisma.brokerages.findMany({
        where: { status: "active" },
        select: { name: true },
        orderBy: { name: "asc" },
      });
      return json(rows.map((r) => r.name));
    },
    { allowedRoles: ["agent", "admin", "tc"] }
  )) as Response;
}
