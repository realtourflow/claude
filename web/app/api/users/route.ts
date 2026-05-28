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
