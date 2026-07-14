/**
 * GET /api/me/calendar/events — read-only view of the agent's EXTERNAL calendar
 * events (Google + Microsoft), merged across every connected provider, for a
 * date window. FF6 two-way sync (read path). Powers the busy-marker overlay on
 * the agent calendar; RealTourFlow never edits these events.
 *
 * Query params (optional):
 *   start — ISO date/datetime; window start. Default: now.
 *   end   — ISO date/datetime; window end.   Default: start + 30 days.
 *
 * Not connected → { events: [] } (no error).
 */
import { json, withAuth, error } from "@/lib/http";
import { resolveUserId } from "@/lib/users";
import { fanInEvents } from "@/lib/calendar";

const DAY_MS = 86_400_000;
const MAX_WINDOW_MS = 366 * DAY_MS; // guard against unbounded provider queries

export async function GET(req: Request): Promise<Response> {
  return (await withAuth(req, async (claims): Promise<Response> => {
    const userId = await resolveUserId(claims.sub);
    if (!userId) return error("user not found", 401);

    const url = new URL(req.url);
    const startParam = url.searchParams.get("start");
    const endParam = url.searchParams.get("end");

    const start = startParam ? new Date(startParam) : new Date();
    if (Number.isNaN(start.getTime())) return error("invalid start", 400);

    const end = endParam ? new Date(endParam) : new Date(start.getTime() + 30 * DAY_MS);
    if (Number.isNaN(end.getTime())) return error("invalid end", 400);

    if (end.getTime() <= start.getTime()) return error("end must be after start", 400);
    if (end.getTime() - start.getTime() > MAX_WINDOW_MS) {
      return error("window too large (max 366 days)", 400);
    }

    const events = await fanInEvents(userId, { start, end });
    return json({ events });
  })) as Response;
}
