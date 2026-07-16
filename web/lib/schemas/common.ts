/**
 * Shared zod building blocks for the wire schemas (#88).
 * Client-safe: zod only.
 */
import { z } from "zod";

/**
 * A Postgres-DECIMAL-compatible numeric string ("500000", "-2.5").
 *
 * POST /api/deals has always accepted string prices — its raw SQL casts the
 * parameter with `::decimal` — so the schema keeps that tolerance. Garbage
 * strings now 400 at the boundary instead of blowing up inside Postgres.
 */
export const decimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "must be a number");

/**
 * A calendar date in `YYYY-MM-DD` form (Postgres `date`). Rejects garbage
 * ("banana") at the regex, and out-of-range values ("2026-13-99", "2026-02-30")
 * via a round-trip check — JS ISO parsing returns Invalid Date for those, and
 * the equality guard catches any value the engine would silently normalize.
 * Used for POST /api/deals `closing_date` (#253) so a malformed value 400s at
 * the boundary instead of being dropped or 500ing inside Postgres.
 */
export const dateOnlyString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date (YYYY-MM-DD)")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "must be a valid calendar date");
