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
