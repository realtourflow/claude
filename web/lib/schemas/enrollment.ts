/**
 * Fast Pass / Smooth Exit enrollment request bodies (#88).
 *
 * These land in a JSONB column, so pre-#88 nothing rejected junk — a string
 * estimated_sale_price simply persisted as a string. The schemas type the
 * fields the server actually stores; the deliberately-ignored client totals
 * stay unknown (the server prices enrollments — #78/#81 — so their shape
 * never mattered and rejecting them would break older clients for no gain).
 *
 * Catalog membership (`unknown upsell: x`) and the fastpass payment-option
 * whitelist stay in the handlers — their exact 400 messages are asserted in
 * tests and load-bearing for the surveys.
 *
 * Client-safe: zod only.
 */
import { z } from "zod";

/** POST /api/deals/[id]/fastpass */
export const fastPassEnrollBodySchema = z.object({
  // now | at_closing | seller_concession — whitelist stays in the handler.
  payment_option: z.string().nullish(),
  selected_upsells: z.array(z.string()).optional(),
  /** Client-sent; deliberately ignored — the server prices the enrollment. */
  total_cents: z.unknown().optional(),
  /** Arbitrary JSON from the survey. */
  survey_answers: z.unknown().optional(),
});
export type FastPassEnrollBody = z.output<typeof fastPassEnrollBodySchema>;

/** POST /api/deals/[id]/smoothexit */
export const smoothExitEnrollBodySchema = z.object({
  // from_proceeds | buyer_concession — stored as-is (legacy Go parity).
  payment_option: z.string().nullish(),
  estimated_sale_price: z.number().nullish(),
  fee_cents: z.number().nullish(),
  /** Arbitrary JSON from the survey. */
  survey_answers: z.unknown().optional(),
  selected_upsells: z.array(z.string()).optional(),
  /** Client-sent; deliberately ignored — the server prices upsells. */
  upsell_total_cents: z.unknown().optional(),
});
export type SmoothExitEnrollBody = z.output<typeof smoothExitEnrollBodySchema>;
