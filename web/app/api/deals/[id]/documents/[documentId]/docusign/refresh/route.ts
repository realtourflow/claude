import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { hasDealAccess } from "@/lib/deals";
import { getDocusignClient } from "@/lib/docusign";

type Ctx = { params: Promise<{ id: string; documentId: string }> };

// POST /api/deals/[id]/documents/[documentId]/docusign/refresh
// Ports RefreshDocuSignStatus in backend/internal/handlers/docusign.go.
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId, documentId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    // Agent owner or any participant may refresh the status.
    const access = await hasDealAccess(dealId, userId);
    if (!access) return error("access denied", 403);

    const docusign = getDocusignClient();
    if (!docusign.enabled()) {
      return error("DocuSign not configured", 503);
    }

    const doc = await prisma.documents.findFirst({
      where: { id: documentId, deal_id: dealId },
      select: { docusign_envelope_id: true },
    });
    if (!doc || !doc.docusign_envelope_id) {
      return error("no envelope found", 404);
    }

    let status: string;
    try {
      status = await docusign.getEnvelopeStatus(doc.docusign_envelope_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return error("failed to get envelope status: " + msg, 502);
    }

    await prisma.documents.update({
      where: { id: documentId },
      data: { docusign_status: status },
    });

    return json({ status });
  })) as Response;
}
