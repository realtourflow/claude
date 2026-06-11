/**
 * Tiny iCal (RFC 5545) serializer — enough to satisfy Apple Calendar,
 * Google Calendar, and Outlook subscription feeds. Mirrors the
 * `CalendarFeed` handler in the legacy Go backend.
 */

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function fmtUTC(d: Date): string {
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function fmtDate(d: Date): string {
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate())
  );
}

function escape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\n/g, "\\n");
}

export type ICalEvent = {
  uid: string;
  summary: string;
  description?: string;
  start: Date;
  end?: Date;
  allDay?: boolean;
};

export function renderICal(events: ICalEvent[], calendarName = "RealTour Flow"): string {
  const now = fmtUTC(new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RealTour Flow//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escape(calendarName)}`,
  ];
  for (const e of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${e.uid}`);
    lines.push(`DTSTAMP:${now}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${fmtDate(e.start)}`);
      if (e.end) lines.push(`DTEND;VALUE=DATE:${fmtDate(e.end)}`);
    } else {
      lines.push(`DTSTART:${fmtUTC(e.start)}`);
      if (e.end) lines.push(`DTEND:${fmtUTC(e.end)}`);
    }
    lines.push(`SUMMARY:${escape(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${escape(e.description)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
