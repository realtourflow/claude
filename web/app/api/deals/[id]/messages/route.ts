import { error, json, withAuth } from "@/lib/http";
import { resolveUserId } from "@/lib/users";
import { hasRole } from "@/lib/roles";
import {
  createMessage,
  getMessageAccess,
  listMessages,
} from "@/lib/messages";
import { createNotification } from "@/lib/notifications";
import { emailNewMessage } from "@/lib/notification-email";
import { prisma } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

type Channel = "client_thread" | "internal";

function parseChannel(value: string | null): Channel {
  return value === "internal" ? "internal" : "client_thread";
}

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    const access = await getMessageAccess(dealId, userId);

    // Read access beyond agent/participant (#167): admins are global; a TC
    // linked by the deal's agent (users.tc_user_id) may read too.
    const privilegedReader =
      hasRole(claims.roles, ["admin"]) ||
      (hasRole(claims.roles, ["tc"]) && access.isLinkedTC);

    if (!access.hasAccess && !privilegedReader) {
      return error("deal not found", 404);
    }

    const url = new URL(req.url);
    const channel = parseChannel(url.searchParams.get("channel"));

    // Internal thread is "Agent + TC only — not visible to clients" (#177):
    // client participants stay blocked; the owning agent, admins, and the
    // linked TC may read it.
    if (!access.isAgent && !privilegedReader && channel === "internal") {
      return error("forbidden", 403);
    }
    const messages = await listMessages(dealId, channel);
    return json(messages);
  })) as Response;
}

type CreateBody = { channel?: string; body?: string };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const { id: dealId } = await ctx.params;
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);
    const access = await getMessageAccess(dealId, userId);

    // The agent's linked TC (users.tc_user_id) is internal-channel-eligible
    // (#178): they may post to the internal thread even without a
    // deal_participants row. Role claim required — defense in depth.
    const linkedTC = hasRole(claims.roles, ["tc"]) && access.isLinkedTC;
    if (!access.hasAccess && !linkedTC) return error("deal not found", 404);

    let body: CreateBody;
    try {
      body = (await req.json()) as CreateBody;
    } catch {
      return error("invalid request body", 400);
    }
    const text = typeof body.body === "string" ? body.body : "";
    if (!text) return error("body is required", 400);

    // Default to client_thread. The internal thread is "Agent + TC only"
    // (#177): the agent and the linked TC post to it as-is (#178); client
    // participants posting to `internal` are quietly demoted — matches the
    // Go behavior.
    let channel: Channel = parseChannel(body.channel ?? null);
    const internalEligible = access.isAgent || linkedTC;
    if (!internalEligible && channel === "internal") channel = "client_thread";

    // A linked TC without a participant row has internal-only posting rights —
    // never let their message land on the client-visible thread (#178).
    if (!access.hasAccess && channel !== "internal") {
      return error("forbidden", 403);
    }

    const message = await createMessage({
      dealId,
      senderId: userId,
      channel,
      body: text,
    });

    // Notification fan-out — agent → all participants; participant → the
    // agent. AWAITED, not detached: on Vercel a stray promise may never run
    // once the response is sent. Best-effort throughout: createNotification
    // swallows internally, the participant lookup is wrapped here, so a
    // notification failure never fails the send.
    //
    // Channel guard (#177): the internal thread is "Agent + TC only — not
    // visible to clients", so internal posts must NEVER create notifications
    // for client participants (the snippet leaks agent/TC-only content).
    // Internal fan-out goes to TC participants AND the agent's linked TC
    // (users.tc_user_id, #178) — deduped; client_thread fan-out is unchanged
    // (all participants).
    try {
      const title = "New message on your deal";
      const snippet = text.length > 80 ? text.slice(0, 80) + "…" : text;
      if (access.isAgent) {
        const participants = await prisma.deal_participants.findMany({
          where:
            channel === "internal"
              ? { deal_id: dealId, role: "tc" }
              : { deal_id: dealId },
          select: { user_id: true },
        });
        const recipientIds = new Set(participants.map((p) => p.user_id));
        if (channel === "internal") {
          // The poster IS the deal agent here, so their own tc_user_id is the
          // deal's linked TC.
          const agentRow = await prisma.users.findUnique({
            where: { id: userId },
            select: { tc_user_id: true },
          });
          if (agentRow?.tc_user_id) recipientIds.add(agentRow.tc_user_id);
        }
        recipientIds.delete(userId); // never notify the sender
        for (const recipientId of recipientIds) {
          await createNotification({
            userId: recipientId,
            title,
            body: snippet,
            kind: "new_message",
            dealId,
          });
        }
      } else if (access.agentId) {
        await createNotification({
          userId: access.agentId,
          title,
          body: snippet,
          kind: "new_message",
          dealId,
        });
      }
    } catch (err) {
      console.error("message notification fan-out failed", err);
    }

    // Best-effort email to the other party — the lib resolves recipients per
    // channel (client thread → the other side; internal → agent ↔ TC only,
    // #178). Awaited (not detached) so it actually sends on Vercel; a throw
    // must never block the response.
    try {
      await emailNewMessage({
        req,
        dealId,
        senderId: userId,
        senderIsAgent: access.isAgent,
        channel,
        body: text,
      });
    } catch (err) {
      console.error("message notification email failed", err);
    }

    return json(message, 201);
  })) as Response;
}
