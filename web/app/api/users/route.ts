import { json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";

export async function GET(req: Request): Promise<Response> {
  return (await withAuth(
    req,
    async (): Promise<Response> => {
      const users = await prisma.users.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          phone: true,
          // Surfaced so admin (Paul) can see each agent's board (drives forms)
          // and brokerage (to wire brokerage-specific DocuSign forms).
          market: true,
          brokerage: true,
          created_at: true,
          deactivated_at: true,
        },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      });
      return json(users);
    },
    { allowedRoles: ["admin"] }
  )) as Response;
}
