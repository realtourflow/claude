/**
 * Notifications helper. Mirrors createNotification in the legacy Go backend.
 *
 * Durability (T15, #83): the insert is AWAITED by every call site — on Vercel
 * a detached fire-and-forget promise may never run once the response is
 * sent. `createNotification` is async and NEVER rejects: failures are
 * swallowed and logged HERE, so call sites bare-`await` it and a notification
 * failure can never fail the user's mutation. See lib/audit.ts for why this
 * awaited best-effort mechanism was chosen over next/server `after()` (no
 * `waitUntil` outside a running Next server → nondeterministic in tests).
 *
 * Phase 6 will add the typed event union and a listing endpoint. For now this
 * is the minimal insert surface. Call sites: stage advance (participants), new
 * messages (the other party), document uploads (deal clients, #290), task
 * assignments (the assignee, #290), and offer requests (the agent).
 */
import { prisma } from "./db";

export type NotificationInput = {
  userId: string;
  title: string;
  body: string;
  kind: string;
  dealId?: string;
  href?: string;
};

export async function createNotification(input: NotificationInput): Promise<void> {
  try {
    await prisma.notifications.create({
      data: {
        user_id: input.userId,
        title: input.title,
        body: input.body,
        type: input.kind,
        deal_id: input.dealId ?? null,
        href: input.href ?? null,
      },
    });
  } catch (err) {
    console.error("notification insert failed", { input, err });
  }
}
