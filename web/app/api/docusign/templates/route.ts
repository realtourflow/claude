import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import {
  listTemplates,
  listTemplatesForMarket,
  TemplateConfigError,
} from "@/lib/docusign-templates";
import { listAgentFormsForAgent } from "@/lib/agent-forms";

// GET /api/docusign/templates — the configured standard forms the caller can
// send (feeds the send-for-signature form picker). Forms are board-keyed:
// agents see their market's forms plus universal (board-less) ones; admin/TC
// see everything. Config is local env (DOCUSIGN_TEMPLATES); no DocuSign call.
export async function GET(req: Request): Promise<Response> {
  return (await withAuth(
    req,
    async (claims): Promise<Response> => {
      try {
        const userId = await resolveUserId(claims.sub);
        if (!userId) return error("user not found", 404);
        const user = await prisma.users.findUnique({
          where: { id: userId },
          select: { market: true, brokerage: true, markets: true },
        });
        const market = user?.market ?? "";
        const isAdminOrTc =
          claims.roles.includes("admin") || claims.roles.includes("tc");
        // Committed registry exactly as before, then the caller's approved
        // uploaded forms appended (additive — committed list is untouched).
        const committed = isAdminOrTc
          ? listTemplates()
          : listTemplatesForMarket(market);
        const agentForms = await listAgentFormsForAgent({
          agentId: userId,
          brokerage: user?.brokerage ?? "",
          markets: Array.isArray(user?.markets) ? (user.markets as string[]) : [],
        });
        return json({ templates: [...committed, ...agentForms] });
      } catch (err) {
        if (err instanceof TemplateConfigError) return error(err.message, 500);
        throw err;
      }
    },
    { allowedRoles: ["agent", "admin", "tc"] }
  )) as Response;
}
