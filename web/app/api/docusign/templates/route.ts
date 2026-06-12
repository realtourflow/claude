import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import {
  listTemplates,
  listTemplatesForMarket,
  TemplateConfigError,
} from "@/lib/docusign-templates";

// GET /api/docusign/templates — the configured standard forms the caller can
// send (feeds the send-for-signature form picker). Forms are board-keyed:
// agents see their market's forms plus universal (board-less) ones; admin/TC
// see everything. Config is local env (DOCUSIGN_TEMPLATES); no DocuSign call.
export async function GET(req: Request): Promise<Response> {
  return (await withAuth(
    req,
    async (claims): Promise<Response> => {
      try {
        if (claims.roles.includes("admin") || claims.roles.includes("tc")) {
          return json({ templates: listTemplates() });
        }
        const userId = await resolveUserId(claims.sub);
        if (!userId) return error("user not found", 404);
        const user = await prisma.users.findUnique({
          where: { id: userId },
          select: { market: true },
        });
        return json({ templates: listTemplatesForMarket(user?.market ?? "") });
      } catch (err) {
        if (err instanceof TemplateConfigError) return error(err.message, 500);
        throw err;
      }
    },
    { allowedRoles: ["agent", "admin", "tc"] }
  )) as Response;
}
