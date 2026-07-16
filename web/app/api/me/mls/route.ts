/**
 * /me/mls — the calling agent's own SimplyRETS MLS credentials.
 *
 * Mirrors GetMyMLS / PatchMyMLS in the legacy Go backend.
 *
 * GET   → { connected: boolean }   — true iff the user has mls_key set.
 *                                     NEVER returns the secret.
 * PATCH → { ok, connected }        — body { key, secret }. Both empty =
 *                                     disconnect (null both). Otherwise the
 *                                     creds are validated against SimplyRETS
 *                                     before being saved.
 */
import { error, json, withAuth } from "@/lib/http";
import { prisma } from "@/lib/db";
import { resolveUserId } from "@/lib/users";
import { getSimplyretsClient, SimplyRetsAuthError } from "@/lib/simplyrets";

export async function GET(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    const row = await prisma.users.findUnique({
      where: { id: userId },
      select: { mls_key: true },
    });
    return json({ connected: !!row?.mls_key });
  })) as Response;
}

type PatchBody = { key?: string; secret?: string };

export async function PATCH(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 404);

    let body: PatchBody;
    try {
      body = (await req.json()) as PatchBody;
    } catch {
      return error("invalid body", 400);
    }

    const key = (body.key ?? "").trim();
    const secret = (body.secret ?? "").trim();

    // Validate the credentials against SimplyRETS before saving (unless
    // clearing). Mirrors the test-before-save check in the Go handler.
    //
    // Distinguish a genuine auth failure from a transient outage (#309): only a
    // real 401 (SimplyRetsAuthError) means the credentials are wrong. A 5xx /
    // timeout / network error means SimplyRETS is down — we must NOT reject the
    // agent's (possibly correct) creds as invalid, and we return before the DB
    // write below so their previously-saved creds are left untouched.
    if (key !== "" && secret !== "") {
      try {
        await getSimplyretsClient().search(key, secret, { limit: 1 });
      } catch (e) {
        if (e instanceof SimplyRetsAuthError) {
          return error(`MLS credentials are invalid: ${e.message}`, 400);
        }
        return error(
          "SimplyRETS is temporarily unavailable — try again shortly",
          502
        );
      }
    }

    // NULLIF('') so an empty string clears the column (disconnect).
    await prisma.users.update({
      where: { id: userId },
      data: {
        mls_key: key === "" ? null : key,
        mls_secret: secret === "" ? null : secret,
        updated_at: new Date(),
      },
    });

    return json({ ok: true, connected: key !== "" });
  })) as Response;
}
