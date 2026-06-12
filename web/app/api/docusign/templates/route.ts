import { error, json, withAuth } from "@/lib/http";
import { listTemplates, TemplateConfigError } from "@/lib/docusign-templates";

// GET /api/docusign/templates — the configured standard forms an agent can
// send (feeds the send-for-signature form picker). Config is local env
// (DOCUSIGN_TEMPLATES); no DocuSign API call.
export async function GET(req: Request): Promise<Response> {
  return (await withAuth(
    req,
    async (): Promise<Response> => {
      try {
        return json({ templates: listTemplates() });
      } catch (err) {
        if (err instanceof TemplateConfigError) return error(err.message, 500);
        throw err;
      }
    },
    { allowedRoles: ["agent", "admin", "tc"] }
  )) as Response;
}
