/**
 * Stage auto-task definitions (#87).
 *
 * The per-stage task list generated when a deal advances into a stage. This
 * lives in lib/ (not the DealDetail component) so BOTH surfaces share one
 * source of truth:
 *   - the StageAdvanceModal preview ("Tasks to be created"), and
 *   - the server-side seed in the stage PATCH handler (lib/stage-task-seed.ts),
 *     which is where the tasks are actually created now. Previously the browser
 *     looped POST /tasks after the advance, so a tab closed mid-loop (or any
 *     non-UI caller) left an advanced deal with missing tasks.
 *
 * Pure + dependency-free (no React, no Prisma): the generators only read the
 * deal's type + client name, so both the client bundle and the server route can
 * import this without dragging the other's dependencies along.
 */

export type AutoTask = {
  title: string;
  description?: string;
  assignedTo: "agent" | "tc";
  priority: "high" | "medium" | "low";
};

/** Minimal deal shape the generators read. */
export type AutoTaskDeal = { type: string; clientName: string };

const STAGE_AUTO_TASKS: Record<string, (deal: AutoTaskDeal) => AutoTask[]> = {
  active_search: (d) => [
    ...(d.type === "buy"
      ? [
          { title: `Send pre-approval checklist — ${d.clientName}`, assignedTo: "agent" as const, priority: "high" as const },
          { title: "Schedule initial buyer consultation", assignedTo: "agent" as const, priority: "medium" as const },
          { title: "Set up saved MLS search for client", assignedTo: "agent" as const, priority: "medium" as const },
        ]
      : [
          { title: `Schedule listing strategy call — ${d.clientName}`, assignedTo: "agent" as const, priority: "high" as const },
          { title: "Pull comparable sales (CMA)", assignedTo: "agent" as const, priority: "high" as const },
          { title: "Order professional photography", assignedTo: "agent" as const, priority: "medium" as const },
        ]),
  ],
  offer_active: (d) => [
    ...(d.type === "buy"
      ? [
          { title: `Review offer details with ${d.clientName}`, assignedTo: "agent" as const, priority: "high" as const },
          { title: "Prepare purchase agreement", assignedTo: "agent" as const, priority: "high" as const },
          { title: "Submit offer to listing agent", assignedTo: "agent" as const, priority: "high" as const },
          { title: `Send earnest money instructions — ${d.clientName}`, assignedTo: "tc" as const, priority: "high" as const },
        ]
      : [
          { title: `Review offer with ${d.clientName}`, assignedTo: "agent" as const, priority: "high" as const },
          { title: "Request proof of funds / pre-approval from buyer", assignedTo: "agent" as const, priority: "high" as const },
          { title: "Prepare counter offer if applicable", assignedTo: "agent" as const, priority: "medium" as const },
        ]),
  ],
  under_contract: (d) => [
    ...(d.type === "buy"
      ? [
          { title: `Schedule home inspection — ${d.clientName}`, assignedTo: "agent" as const, priority: "high" as const },
          { title: "Send executed contract to TC", assignedTo: "agent" as const, priority: "high" as const },
          { title: "Open title file with title company", assignedTo: "tc" as const, priority: "high" as const },
          { title: `Confirm loan milestones with lender — ${d.clientName}`, assignedTo: "agent" as const, priority: "medium" as const },
          { title: `Send wire / EMD instructions to ${d.clientName}`, assignedTo: "tc" as const, priority: "high" as const },
        ]
      : [
          { title: "Send executed contract to TC", assignedTo: "agent" as const, priority: "high" as const },
          { title: "Open title file with title company", assignedTo: "tc" as const, priority: "high" as const },
          { title: `Respond to repair request — ${d.clientName}`, description: "Seller must respond within the contractual deadline", assignedTo: "agent" as const, priority: "high" as const },
          { title: "Confirm appraisal scheduling with buyer agent", assignedTo: "agent" as const, priority: "medium" as const },
        ]),
  ],
  pre_close: (d) => [
    { title: `Schedule final walkthrough — ${d.clientName}`, assignedTo: "agent" as const, priority: "high" as const },
    { title: "Verify clear-to-close status with lender", assignedTo: "agent" as const, priority: "high" as const },
    { title: "Confirm closing time and location with title company", assignedTo: "tc" as const, priority: "high" as const },
    { title: `Remind ${d.clientName} to bring government ID to closing`, assignedTo: "agent" as const, priority: "medium" as const },
    { title: "Review ALTA / HUD-1 settlement statement", assignedTo: "tc" as const, priority: "high" as const },
  ],
  closing: (d) => [
    { title: "Confirm all parties for closing", assignedTo: "tc" as const, priority: "high" as const },
    { title: `Verify wire instructions with ${d.clientName}`, assignedTo: "agent" as const, priority: "high" as const },
    { title: "Final clear-to-close check", assignedTo: "tc" as const, priority: "high" as const },
  ],
  post_close: (d) => [
    { title: `Request 5-star review — ${d.clientName}`, assignedTo: "agent" as const, priority: "high" as const },
    { title: `Send $50 referral program info to ${d.clientName}`, assignedTo: "agent" as const, priority: "medium" as const },
    { title: "Submit commission paperwork to brokerage", assignedTo: "agent" as const, priority: "high" as const },
    { title: "Update CRM with closed deal status", assignedTo: "agent" as const, priority: "low" as const },
  ],
};

/**
 * The auto-tasks to create when a deal enters `stage`. Returns `[]` for stages
 * with no automation (e.g. `intake`).
 */
export function stageAutoTasks(stage: string, deal: AutoTaskDeal): AutoTask[] {
  return STAGE_AUTO_TASKS[stage]?.(deal) ?? [];
}
