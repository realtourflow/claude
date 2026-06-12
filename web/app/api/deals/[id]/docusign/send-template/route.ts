import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { loadDealPeople } from "@/lib/deals";
import { getDocusignClient } from "@/lib/docusign";
import {
  getTemplateConfig,
  TemplateConfigError,
  UnknownFormError,
} from "@/lib/docusign-templates";
import {
  assignTemplateRoles,
  RoutingError,
  type RoleOverride,
} from "@/lib/docusign-routing";
import { sendTemplateEnvelope } from "@/lib/docusign-documents";

type Ctx = { params: Promise<{ id: string }> };

type SendTemplateBody = {
  form_key?: string;
  // Optional per-role overrides: pick a different participant for a role
  // ({role_name, user_id}) or hand a role to an outside signer
  // ({role_name, email, name} — they get the DocuSign email; hybrid model).
  assignments?: RoleOverride[];
};

// POST /api/deals/[id]/docusign/send-template — the PRIMARY send path.
// Sends a configured DocuSign template (fields are tagged on the template, so
// placement is always correct), auto-filling roles from the deal's
// participants + agent. Creates the pending-signature documents row (template
// sends have no uploaded PDF until the signed copy is archived).
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    // Only the owning agent may send for signature (same rule as the
    // single-document send route).
    const owned = await prisma.deals.findFirst({
      where: { id: dealId, agent_id: userId },
      select: { id: true },
    });
    if (!owned) return error("deal not found or access denied", 404);

    const docusign = getDocusignClient();
    if (!docusign.enabled()) {
      return error("DocuSign not configured", 503);
    }

    let body: SendTemplateBody;
    try {
      body = (await req.json()) as SendTemplateBody;
    } catch {
      return error("form_key required", 400);
    }
    if (!body.form_key) return error("form_key required", 400);

    let template;
    try {
      template = getTemplateConfig(body.form_key);
    } catch (err) {
      if (err instanceof UnknownFormError) return error(err.message, 400);
      if (err instanceof TemplateConfigError) return error(err.message, 500);
      throw err;
    }

    const people = await loadDealPeople(dealId);
    let roles;
    try {
      roles = assignTemplateRoles({
        roleMapping: template.roleMapping,
        people,
        overrides: body.assignments,
      });
    } catch (err) {
      if (err instanceof RoutingError) return error(err.message, 400);
      throw err;
    }

    let sent;
    try {
      sent = await sendTemplateEnvelope({
        dealId,
        uploadedBy: userId,
        template: {
          templateId: template.templateId,
          label: template.label,
          purpose: template.purpose,
        },
        roles,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return error("failed to create envelope: " + msg, 502);
    }

    const doc = await prisma.documents.findUnique({
      where: { id: sent.documentId },
    });
    return json({
      envelope_id: sent.envelopeId,
      status: "sent",
      document: doc && {
        id: doc.id,
        deal_id: doc.deal_id,
        name: doc.name,
        s3_key: doc.s3_key,
        mime_type: doc.mime_type,
        file_size: Number(doc.file_size),
        purpose: doc.purpose,
        docusign_envelope_id: doc.docusign_envelope_id,
        docusign_status: doc.docusign_status,
        docusign_sent_at: doc.docusign_sent_at,
        created_at: doc.created_at,
      },
    });
  })) as Response;
}
