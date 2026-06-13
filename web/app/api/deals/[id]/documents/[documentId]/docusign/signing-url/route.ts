import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { hasDealAccess } from "@/lib/deals";
import { getDocusignClient } from "@/lib/docusign";

type Ctx = { params: Promise<{ id: string; documentId: string }> };

// POST /api/deals/[id]/documents/[documentId]/docusign/signing-url
//
// Embedded signing entry point: an authenticated portal user (deal participant
// or the agent) gets a DocuSign recipient-view URL for THEIR recipient slot on
// the document's envelope. URLs are single-use and expire in ~5 minutes, so
// they are generated on click and never stored — if the user bounces, the next
// click mints a fresh one.
//
// The recipient-view triple (clientUserId, email, userName) must EXACTLY match
// the envelope recipient, so we echo the send-time SNAPSHOT from the
// docusign_recipients row — never live profile values, which drift.
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId, documentId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    const access = await hasDealAccess(dealId, userId);
    if (!access) return error("deal not found", 404);

    const docusign = getDocusignClient();
    if (!docusign.enabled()) {
      return error("DocuSign not configured", 503);
    }

    // Matched by user_id — the identity link written at send time.
    const recipient = await prisma.docusign_recipients.findFirst({
      where: { document_id: documentId, user_id: userId },
      select: {
        envelope_id: true,
        email: true,
        name: true,
        client_user_id: true,
        status: true,
      },
    });
    if (!recipient) {
      return error("you are not a signer on this document", 404);
    }
    if (!recipient.client_user_id) {
      // Sent as an email recipient (pre-embedded envelope or outside signer):
      // their signing link lives in their inbox, not here.
      return error(
        "this document was sent to your email — check your inbox for the DocuSign link",
        409
      );
    }
    if (recipient.status === "completed" || recipient.status === "declined") {
      return error(`you have already ${recipient.status} this document`, 409);
    }
    const doc = await prisma.documents.findFirst({
      where: { id: documentId, deal_id: dealId },
      select: { docusign_status: true },
    });
    if (!doc) return error("document not found", 404);
    if (doc.docusign_status === "voided") {
      return error("this envelope was voided", 409);
    }

    // Return into the caller's portal. DocuSign appends
    // event=signing_complete|cancel|decline|session_timeout.
    const caller = await prisma.users.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    const origin = new URL(req.url).origin;
    const returnUrl =
      caller?.role === "buyer"
        ? `${origin}/buyer/${userId}?signed_doc=${documentId}`
        : caller?.role === "seller"
          ? `${origin}/seller/${userId}?signed_doc=${documentId}`
          : `${origin}/agent/deals/${dealId}?signed_doc=${documentId}`;

    let url: string;
    try {
      url = await docusign.createRecipientView(recipient.envelope_id, {
        clientUserId: recipient.client_user_id,
        email: recipient.email,
        userName: recipient.name,
        returnUrl,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return error("failed to create signing session: " + msg, 502);
    }

    return json({ url });
  })) as Response;
}
