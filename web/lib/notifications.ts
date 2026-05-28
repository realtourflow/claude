/**
 * Notifications helper. Fire-and-forget — mirrors createNotification in
 * backend/internal/handlers/notifications.go.
 *
 * Phase 6 will add the typed event union and a listing endpoint. For now
 * this is just the minimal insert surface used by Phase 3 (stage advance
 * notifies participants, task creation/completion notifies the owner, etc.).
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

export function createNotification(input: NotificationInput): void {
  void (async () => {
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
  })();
}
