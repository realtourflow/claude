/**
 * Stage-history wire contract (#256, #88 pattern): a `deal_stage_history` row
 * as GET /api/deals/[id]/stage-history serializes it.
 *
 * Client-safe (zod only, no server imports) so the useStageHistory hook can
 * validate the response with checkWire. `from_stage` is nullable (the first
 * transition of a deal created outside the intake stage has no prior stage);
 * both stage fields are cast to text on the wire, so they arrive as strings.
 */
import { z } from "zod";

export const apiStageHistorySchema = z.object({
  from_stage: z.string().nullable(),
  to_stage: z.string(),
  changed_at: z.string(),
  changed_by: z.string(),
});
export type ApiStageHistory = z.output<typeof apiStageHistorySchema>;

export const apiStageHistoryListSchema = z.array(apiStageHistorySchema);
