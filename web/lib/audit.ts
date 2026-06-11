/**
 * Audit log helper. Mirrors the legacy Go backend.
 *
 * Always non-blocking: errors are swallowed and logged to console. The Go
 * implementation runs in a goroutine; we use a fire-and-forget Promise.
 *
 * Phase 6 will add the typed event-type union and admin-side listing endpoint.
 * For now this is the minimal surface needed by Phase 2 (user activate/deactivate).
 */
import { prisma } from "./db";

export type AuditEvent = {
  actorId?: string;
  eventType: string;
  dealId?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
};

export function logAudit(event: AuditEvent): void {
  void (async () => {
    try {
      await prisma.audit_log.create({
        data: {
          actor_id: event.actorId ?? null,
          event_type: event.eventType,
          deal_id: event.dealId ?? null,
          target_id: event.targetId ?? null,
          metadata: (event.metadata ?? null) as never,
        },
      });
    } catch (err) {
      console.error("audit log insert failed", { event, err });
    }
  })();
}
