/**
 * Client-safe wire-contract checking (#88).
 *
 * `checkWire(schema, data, label)` validates an API response against its
 * zod schema in dev/test and logs a console warning on mismatch — the
 * class of bug behind #85 (DECIMAL columns arriving as strings while the
 * hand-written wire type claimed number). In production it is a no-op.
 *
 * It always returns the original data unchanged, so runtime behavior is
 * identical in every environment — this is detection, not coercion.
 *
 * This module must stay importable from "use client" hooks: zod only, no
 * server imports.
 */
import { z } from "zod";

export function checkWire<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  if (process.env.NODE_ENV !== "production") {
    const result = schema.safeParse(data);
    if (!result.success) {
      console.warn(
        `[wire] ${label}: response does not match its schema`,
        result.error.issues.slice(0, 5)
      );
    }
  }
  return data as T;
}
