/**
 * Audit log helper. Mirrors the legacy Go backend.
 *
 * Durability (T15, #83): the insert is AWAITED by every call site. On Vercel a
 * function can freeze the moment the response is sent, so the old detached
 * fire-and-forget promise could silently drop audit rows.
 * `logAudit` is async and NEVER rejects — failures are swallowed and logged
 * HERE, so call sites bare-`await` it with no try/catch and an audit failure
 * can never fail the user's mutation (same best-effort contract as the email
 * and calendar paths).
 *
 * Why awaited rather than next/server `after()`: `after()` defers the write
 * until after the response via the platform's `waitUntil`, which only exists
 * inside a running Next server — when routes are invoked as plain functions
 * (Vitest) the callback is exactly as nondeterministic as the detached promise
 * it would replace. The awaited write is one extra round trip to the same
 * Postgres the mutation just wrote to, and matches the house style already
 * used for notification emails (lib/notification-email.ts) and calendar push
 * (lib/jobs.ts).
 *
 * Phase 6 will add the typed event-type union and admin-side listing endpoint.
 */
import { prisma } from "./db";

export type AuditEvent = {
  actorId?: string;
  eventType: string;
  dealId?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
};

export async function logAudit(event: AuditEvent): Promise<void> {
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
}
