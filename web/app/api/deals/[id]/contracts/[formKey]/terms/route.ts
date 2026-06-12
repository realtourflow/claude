import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import {
  getTemplateConfig,
  TemplateConfigError,
  UnknownFormError,
} from "@/lib/docusign-templates";
import { ContractDataError, upsertTerms } from "@/lib/contract-facts";

type Ctx = { params: Promise<{ id: string; formKey: string }> };

// PUT /api/deals/[id]/contracts/[formKey]/terms — save the form-specific
// values (checkboxes, day counts, caps...) validated against the form's
// fieldMap. Owner-agent only.
export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId, formKey } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    const owned = await prisma.deals.findFirst({
      where: { id: dealId, agent_id: userId },
      select: { id: true },
    });
    if (!owned) return error("deal not found or access denied", 404);

    let template;
    try {
      template = getTemplateConfig(formKey);
    } catch (err) {
      if (err instanceof UnknownFormError) return error(err.message, 400);
      if (err instanceof TemplateConfigError) return error(err.message, 500);
      throw err;
    }

    let body: { terms?: Record<string, unknown> };
    try {
      body = (await req.json()) as { terms?: Record<string, unknown> };
    } catch {
      return error("invalid request body", 400);
    }
    if (!body.terms || typeof body.terms !== "object") {
      return error("terms object required", 400);
    }

    try {
      await upsertTerms(dealId, formKey, template.fieldMap, body.terms);
    } catch (err) {
      if (err instanceof ContractDataError) return error(err.message, 400);
      throw err;
    }
    return json({ ok: true });
  })) as Response;
}
