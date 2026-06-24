/**
 * GET /api/_diag/db-host — TEMPORARY production DB identification probe.
 *
 * Purpose: confirm WHICH database the production runtime actually connects to,
 * without anyone reading the locked (Sensitive) DATABASE_URL password. Returns
 * ONLY non-secret connection identity:
 *   - the host / port / db-name / sslmode parsed from DATABASE_URL (no creds)
 *   - current_database() + inet_server_addr() from a live query
 *
 * Gated by PROBE_TOKEN (a throwaway env var added only for this check) so the
 * real CRON_SECRET — itself a sensitive var nobody can read — isn't needed to
 * call it. DELETE this route and remove PROBE_TOKEN immediately after one read.
 */
import { error, json } from "@/lib/http";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Host-only parse of DATABASE_URL: never returns username or password.
function urlIdentity(): {
  url_host: string;
  url_port: string;
  url_db: string;
  url_sslmode: string;
} {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return {
      url_host: u.hostname || "(none)",
      url_port: u.port || "(default)",
      url_db: u.pathname.replace(/^\//, "") || "(none)",
      url_sslmode: u.searchParams.get("sslmode") ?? "(unset)",
    };
  } catch {
    return { url_host: "(unparseable)", url_port: "", url_db: "", url_sslmode: "" };
  }
}

async function handle(req: Request): Promise<Response> {
  const token = process.env.PROBE_TOKEN;
  if (!token) return error("probe token not configured", 503);
  if (req.headers.get("authorization") !== `Bearer ${token}`) {
    return error("unauthorized", 401);
  }

  const id = urlIdentity();
  try {
    const rows = await prisma.$queryRaw<
      { db: string; server_addr: string | null }[]
    >`SELECT current_database() AS db, inet_server_addr()::text AS server_addr`;
    const r = rows[0] ?? { db: "(none)", server_addr: null };
    return json({
      ...id,
      current_database: r.db,
      inet_server_addr: r.server_addr,
      note: "temporary probe — no secret/password returned",
    });
  } catch (err) {
    // Still return the URL-derived host even if the live query fails.
    return json({
      ...id,
      query_error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}
