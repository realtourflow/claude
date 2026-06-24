import { json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";

// GET /api/me/form-types — the document types an agent can pick when uploading a
// form ("this is my purchase agreement"). The choice selects the type's
// position-free field set, which guided vision later locates on the agent's
// layout. Only active types; field_set itself is not sent (the UI just needs the
// pickable label).
export async function GET(req: Request): Promise<Response> {
  return (await withAuth(
    req,
    async (): Promise<Response> => {
      const types = await prisma.form_types.findMany({
        where: { active: true },
        select: {
          key: true,
          label: true,
          description: true,
          side: true,
          field_count: true,
        },
        orderBy: { label: "asc" },
      });
      return json(types);
    },
    { allowedRoles: ["agent", "admin"] }
  )) as Response;
}
