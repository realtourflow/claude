import { error, json } from "@/lib/http";
import { prisma } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/agents/[id]/public — public (unauthenticated) lookup of an agent's
// display NAME only. Pre-auth onboarding screens greet the invited client with
// their agent's name; without this they used to render the raw agent UUID.
// Exposes the name only (no email/phone/PII) and only for users whose role is
// agent.
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  // The param historically carried a literal name fallback; ignore anything
  // that isn't a real UUID so a bad value returns 404 rather than a DB error.
  if (!UUID_RE.test(id)) return error("not found", 404);

  const rows = await prisma.$queryRaw<{ name: string }[]>`
    SELECT name FROM users WHERE id = ${id}::uuid AND role = 'agent'::user_role
  `;
  const row = rows[0];
  if (!row) return error("not found", 404);

  return json({ name: row.name });
}
