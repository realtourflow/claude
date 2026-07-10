import { extractClosingDate, parseDateOnly } from "@/lib/arive-dates";
import { prisma } from "@/lib/db";
import { renderICal, type ICalEvent } from "@/lib/ical";

type Ctx = { params: Promise<{ token: string }> };

// Public iCal feed protected by the per-user calendar token (not Auth0).
// Pushes closing dates + open task due dates into Apple/Google/Outlook.
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { token } = await ctx.params;
  const user = await prisma.users.findFirst({
    where: { calendar_token: token },
    select: { id: true },
  });
  if (!user) return new Response("not found", { status: 404 });

  // Deals where the user is the agent OR a participant.
  const deals = await prisma.$queryRaw<
    {
      id: string;
      title: string;
      arive_key_dates: unknown;
    }[]
  >`
    SELECT deals.id, deals.title, deals.arive_key_dates
    FROM deals
    WHERE deals.agent_id = ${user.id}::uuid
       OR EXISTS (
         SELECT 1 FROM deal_participants
         WHERE deal_id = deals.id AND user_id = ${user.id}::uuid
       )
  `;

  const events: ICalEvent[] = [];

  for (const d of deals) {
    // Same key selection as the calendar push (lib/jobs.ts) and the deal
    // serializer (hooks/useDeals.ts) — see lib/arive-dates.ts (#196).
    const closingStr = extractClosingDate(d.arive_key_dates);
    if (closingStr) {
      const day = parseDateOnly(closingStr);
      if (day) {
        events.push({
          uid: `close-${d.id}@realtourflow`,
          summary: `Closing: ${d.title}`,
          start: day,
          allDay: true,
        });
      }
    }
  }

  // Open task due dates across the user's owned deals.
  const tasks = await prisma.$queryRaw<
    { id: string; title: string; due_date: Date }[]
  >`
    SELECT t.id, t.title, t.due_date
    FROM tasks t
    JOIN deals d ON d.id = t.deal_id
    WHERE d.agent_id = ${user.id}::uuid
      AND t.status NOT IN ('completed', 'skipped')
      AND t.due_date IS NOT NULL
  `;
  for (const t of tasks) {
    events.push({
      uid: `task-${t.id}@realtourflow`,
      summary: `Task: ${t.title}`,
      start: t.due_date,
      allDay: true,
    });
  }

  const body = renderICal(events);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}
