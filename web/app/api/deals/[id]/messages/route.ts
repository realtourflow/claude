import { error, json, withAuth } from "@/lib/http";
import { resolveUserId } from "@/lib/users";
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
    if (!access.hasAccess) return error("deal not found", 404);

    const url = new URL(req.url);
    const channel = parseChannel(url.searchParams.get("channel"));

    if (!access.isAgent && channel === "internal") {
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
    if (!access.hasAccess) return error("deal not found", 404);

    let body: CreateBody;
    try {
      body = (await req.json()) as CreateBody;
    } catch {
      return error("invalid request body", 400);
    }
    const text = typeof body.body === "string" ? body.body : "";
    if (!text) return error("body is required", 400);

    // Default to client_thread. Non-agents posting to `internal` are quietly
    // demoted — matches the Go behavior.
    let channel: Channel = parseChannel(body.channel ?? null);
    if (!access.isAgent && channel === "internal") channel = "client_thread";

    const message = await createMessage({
      dealId,
      senderId: userId,
      channel,
      body: text,
    });

    // Notification fan-out (fire-and-forget). Agent → all participants;
    // participant → the agent.
    void (async () => {
      try {
        const title = "New message on your deal";
        const snippet = text.length > 80 ? text.slice(0, 80) + "…" : text;
        if (access.isAgent) {
          const participants = await prisma.deal_participants.findMany({
            where: { deal_id: dealId },
            select: { user_id: true },
          });
          for (const p of participants) {
            createNotification({
              userId: p.user_id,
              title,
              body: snippet,
              kind: "new_message",
              dealId,
            });
          }
        } else if (access.agentId) {
          createNotification({
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
    })();

    // Best-effort email to the other party — only on the client thread. Awaited
    // (not detached) so it actually sends on Vercel; a throw must never block
    // the response.
    if (channel === "client_thread") {
      try {
        await emailNewMessage({
          req,
          dealId,
          senderId: userId,
          senderIsAgent: access.isAgent,
          body: text,
        });
      } catch (err) {
        console.error("message notification email failed", err);
      }
    }

    return json(message, 201);
  })) as Response;
}
