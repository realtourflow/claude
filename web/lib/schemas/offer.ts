/**
 * Offer request bodies (#88). Client-safe: zod only.
 */
import { z } from "zod";

/** POST /api/deals/[id]/offers */
export const createOfferBodySchema = z.object({
  buyer_name: z.string().nullish(),
  // Number only: Prisma's Decimal validation already 500'd on strings, so
  // there is no stringly-typed tolerance to preserve here (unlike deal price).
  offer_price: z.number().nullish(),
  close_date: z
    .string()
    .refine(
      // "" is the survey's "not set" sentinel — the handler maps it to null.
      (s) => s === "" || !Number.isNaN(new Date(s).getTime()),
      "must be a parseable date"
    )
    .nullish(),
  contingencies: z.array(z.string()).nullish(),
  agent_notes: z.string().nullish(),
});
export type CreateOfferBody = z.output<typeof createOfferBodySchema>;
