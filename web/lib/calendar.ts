/**
 * Calendar push — writes RealTourFlow deal/task events into an agent's
 * connected calendar(s). Port of backend/internal/calendar/push.go.
 *
 * Scope today (T5a-1): the Google provider's upsert/delete + idempotency via
 * calendar_event_map + access-token refresh. Microsoft is T5b; this file is
 * structured as a provider list so it slots in there.
 *
 * Best-effort: callers should treat failures as non-fatal (a missed push
 * self-heals on the next stage advance because the upsert patches the same
 * event, keyed by internal_uid).
 *
 * Test seam: setCalendarHttpForTesting() injects a fake `fetch` (mirrors
 * lib/stripe.ts) so tests never hit real Google.
 */
import { prisma } from "./db";
import { env } from "./env";

export type CalendarEvent = {
  /** Stable key we use to find this event again on update/delete (e.g. "close-<dealId>"). */
  internalUid: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  /** Exclusive end for all-day events (Google convention): closing day + 1. */
  end: Date;
  allDay: boolean;
};

export type CalendarProvider = {
  readonly provider: string;
  upsert(userId: string, ev: CalendarEvent): Promise<void>;
  delete(userId: string, internalUid: string): Promise<void>;
};

// ─── HTTP seam ──────────────────────────────────────────────────────────
export type CalendarHttp = (url: string, init?: RequestInit) => Promise<Response>;

let httpStub: CalendarHttp | undefined;
const defaultHttp: CalendarHttp = (url, init) => fetch(url, init);

/** Test-only: inject a fake fetch. Pass undefined to restore the real one. */
export function setCalendarHttpForTesting(fn: CalendarHttp | undefined): void {
  httpStub = fn;
}
function http(): CalendarHttp {
  return httpStub ?? defaultHttp;
}

// ─── calendar_event_map (idempotency) ───────────────────────────────────
async function loadMapping(
  userId: string,
  provider: string,
  internalUid: string
): Promise<string | null> {
  const row = await prisma.calendar_event_map.findUnique({
    where: {
      user_id_provider_internal_uid: {
        user_id: userId,
        provider,
        internal_uid: internalUid,
      },
    },
    select: { external_event_id: true },
  });
  return row?.external_event_id ?? null;
}

async function saveMapping(
  userId: string,
  provider: string,
  internalUid: string,
  externalId: string
): Promise<void> {
  await prisma.calendar_event_map.upsert({
    where: {
      user_id_provider_internal_uid: {
        user_id: userId,
        provider,
        internal_uid: internalUid,
      },
    },
    create: {
      user_id: userId,
      provider,
      internal_uid: internalUid,
      external_event_id: externalId,
    },
    update: { external_event_id: externalId, updated_at: new Date() },
  });
}

async function deleteMapping(
  userId: string,
  provider: string,
  internalUid: string
): Promise<void> {
  await prisma.calendar_event_map.deleteMany({
    where: { user_id: userId, provider, internal_uid: internalUid },
  });
}

// ─── tokens ─────────────────────────────────────────────────────────────
const GOOGLE_PROVIDER = "google_calendar";
const GOOGLE_EVENTS_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

type TokenRow = {
  access_token: string;
  refresh_token: string | null;
  expires_at: Date;
};

async function loadToken(
  userId: string,
  provider: string
): Promise<TokenRow | null> {
  return prisma.oauth_tokens.findUnique({
    where: { user_id_provider: { user_id: userId, provider } },
    select: { access_token: true, refresh_token: true, expires_at: true },
  });
}

/**
 * Returns a usable access token, refreshing + persisting if it's within 60s of
 * expiry. Returns null (no write should happen) when the token is expired and
 * there's no refresh_token, or the refresh call fails.
 */
async function ensureFreshGoogleToken(
  userId: string,
  tok: TokenRow
): Promise<string | null> {
  if (tok.expires_at.getTime() - Date.now() > 60_000) {
    return tok.access_token;
  }
  if (!tok.refresh_token) {
    console.warn(
      `calendar: google token expired and no refresh_token for user ${userId} — reconnect needed`
    );
    return null;
  }
  const form = new URLSearchParams({
    client_id: env().GOOGLE_OAUTH_CLIENT_ID,
    client_secret: env().GOOGLE_OAUTH_CLIENT_SECRET,
    refresh_token: tok.refresh_token,
    grant_type: "refresh_token",
  });
  const res = await http()(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: form.toString(),
  });
  if (!res.ok) {
    console.warn(`calendar: google token refresh failed for user ${userId}: ${res.status}`);
    return null;
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;
  const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000);
  await prisma.oauth_tokens.update({
    where: { user_id_provider: { user_id: userId, provider: GOOGLE_PROVIDER } },
    data: {
      access_token: data.access_token,
      expires_at: expiresAt,
      updated_at: new Date(),
    },
  });
  return data.access_token;
}

// ─── Google provider ────────────────────────────────────────────────────
function formatAllDay(d: Date): string {
  // YYYY-MM-DD in UTC — closing dates are date-only, parsed as UTC midnight.
  return d.toISOString().slice(0, 10);
}

function googlePayload(ev: CalendarEvent): Record<string, unknown> {
  const body: Record<string, unknown> = { summary: ev.summary };
  if (ev.description) body.description = ev.description;
  if (ev.location) body.location = ev.location;
  if (ev.allDay) {
    body.start = { date: formatAllDay(ev.start) };
    body.end = { date: formatAllDay(ev.end) };
  } else {
    body.start = { dateTime: ev.start.toISOString(), timeZone: "America/Chicago" };
    body.end = { dateTime: ev.end.toISOString(), timeZone: "America/Chicago" };
  }
  return body;
}

async function googleWrite(
  userId: string,
  ev: CalendarEvent,
  accessToken: string
): Promise<void> {
  const externalId = await loadMapping(userId, GOOGLE_PROVIDER, ev.internalUid);
  const method = externalId ? "PATCH" : "POST";
  const url = externalId ? `${GOOGLE_EVENTS_URL}/${externalId}` : GOOGLE_EVENTS_URL;

  const res = await http()(url, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(googlePayload(ev)),
  });

  // The mapped event was deleted in Google directly → drop the stale mapping
  // and re-insert as a fresh POST.
  if (externalId && res.status === 404) {
    await deleteMapping(userId, GOOGLE_PROVIDER, ev.internalUid);
    return googleWrite(userId, ev, accessToken);
  }
  if (!res.ok) {
    throw new Error(
      `google calendar ${method} returned ${res.status}: ${await safeText(res)}`
    );
  }
  const out = (await res.json()) as { id?: string };
  if (out.id) {
    await saveMapping(userId, GOOGLE_PROVIDER, ev.internalUid, out.id);
  }
}

export const googleProvider: CalendarProvider = {
  provider: GOOGLE_PROVIDER,

  async upsert(userId, ev) {
    const tok = await loadToken(userId, GOOGLE_PROVIDER);
    if (!tok) return; // not connected → best-effort no-op (zero HTTP)
    const accessToken = await ensureFreshGoogleToken(userId, tok);
    if (!accessToken) return; // expired + unrefreshable → no-op
    await googleWrite(userId, ev, accessToken);
  },

  async delete(userId, internalUid) {
    const externalId = await loadMapping(userId, GOOGLE_PROVIDER, internalUid);
    if (!externalId) return;
    const tok = await loadToken(userId, GOOGLE_PROVIDER);
    if (!tok) return;
    const accessToken = await ensureFreshGoogleToken(userId, tok);
    if (!accessToken) return;

    const res = await http()(`${GOOGLE_EVENTS_URL}/${externalId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    // 404/410 mean it's already gone — treat as success and drop the mapping.
    if (res.ok || res.status === 404 || res.status === 410) {
      await deleteMapping(userId, GOOGLE_PROVIDER, internalUid);
      return;
    }
    throw new Error(
      `google calendar DELETE returned ${res.status}: ${await safeText(res)}`
    );
  },
};

// ─── fan-out across connected providers ─────────────────────────────────
// Microsoft (T5b) appends here.
function providers(): CalendarProvider[] {
  return [googleProvider];
}

/** Best-effort upsert to every connected calendar. Per-provider errors are logged, never thrown. */
export async function fanOutUpsert(userId: string, ev: CalendarEvent): Promise<void> {
  for (const p of providers()) {
    try {
      await p.upsert(userId, ev);
    } catch (err) {
      console.error(`calendar push to ${p.provider} for user ${userId} failed`, err);
    }
  }
}

/** Best-effort delete from every connected calendar. */
export async function fanOutDelete(userId: string, internalUid: string): Promise<void> {
  for (const p of providers()) {
    try {
      await p.delete(userId, internalUid);
    } catch (err) {
      console.error(`calendar delete on ${p.provider} for user ${userId} failed`, err);
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}
