/**
 * Background job hooks. These are no-op stubs in Phase 3 — Phase 8 will
 * wire them up to pg-boss for Google Calendar / Microsoft Graph / iCal
 * push. Keeping the call sites in place means handlers stay close to the
 * Go originals; we just don't fire anything yet.
 */

export function enqueuePushDealClosingEvent(dealId: string): void {
  void dealId;
  // TODO(phase-8): enqueue calendar fan-out for closing date.
}

export function enqueuePushTaskDueEvent(taskId: string): void {
  void taskId;
  // TODO(phase-8): enqueue calendar fan-out for task due date.
}
