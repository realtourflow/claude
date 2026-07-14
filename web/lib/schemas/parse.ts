/**
 * Server-side request-body parsing for route handlers (#88).
 *
 * `parseBody(req, schema)` replaces the blind `(await req.json()) as X`
 * casts: malformed JSON and schema mismatches both become a 400 with a
 * concise message (via the shared `error()` helper) instead of a 500 from
 * deep inside Prisma/Postgres.
 *
 * SERVER ONLY — this module imports `@/lib/http` (which reaches the DB via
 * withAuth's deps). Client code (hooks) should use `@/lib/schemas/wire`.
 *
 * Usage:
 *   const parsed = await parseBody(req, createDealBodySchema);
 *   if (!parsed.ok) return parsed.response;
 *   const body = parsed.data;
 */
import { z } from "zod";
import { error } from "@/lib/http";

/** First zod issue as a concise `path: message` string. */
export function firstIssueMessage(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "invalid request body";
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

export type ParsedBody<T> =
  | { ok: true; data: T }
  | { ok: false; response: Response };

export async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S
): Promise<ParsedBody<z.output<S>>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    // Same message the handlers returned for unparseable JSON pre-#88.
    return { ok: false, response: error("invalid request body", 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: error(firstIssueMessage(parsed.error), 400) };
  }
  return { ok: true, data: parsed.data };
}
