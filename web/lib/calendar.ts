/**
 * Calendar push — writes RealTourFlow deal/task events into an agent's
 * connected calendar(s). Port of the legacy Go backend.
 *
 * Two providers (Google + Microsoft Graph) share one upsert/delete/refresh core
 * parameterized by a ProviderConfig; the fan-out iterates both, and each
 * self-gates on whether the agent has that provider's oauth_tokens row — so an
 * agent connected to both gets one event per provider from a single trigger,
 * idempotently (calendar_event_map is keyed per-provider).
 *
 * Failure contract: fanOutUpsert/fanOutDelete attempt every provider, then
 * throw if any failed — the durable queue (lib/queue.ts) relies on the throw to
 * schedule a retry. Mutation-path callers (lib/jobs.ts) swallow the inline
 * failure; a missed push also self-heals on the next mutation because the
 * upsert patches the same event by internal_uid.
 *
 * Test seam: setCalendarHttpForTesting() injects a fake `fetch` (mirrors
 * lib/stripe.ts) so tests never hit real Google / Microsoft.
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
  /** Exclusive end for all-day events (closing day + 1). */
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

// ─── calendar_event_map (per-provider idempotency) ──────────────────────
async function loadMapping(
  userId: string,
  provider: string,
  internalUid: string
): Promise<string | null> {
  const row = await prisma.calendar_event_map.findUnique({
    where: {
      user_id_provider_internal_uid: { user_id: userId, provider, internal_uid: internalUid },
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
      user_id_provider_internal_uid: { user_id: userId, provider, internal_uid: internalUid },
    },
    create: { user_id: userId, provider, internal_uid: internalUid, external_event_id: externalId },
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
type TokenRow = {
  access_token: string;
  refresh_token: string | null;
  expires_at: Date;
};

async function loadToken(userId: string, provider: string): Promise<TokenRow | null> {
  return prisma.oauth_tokens.findUnique({
    where: { user_id_provider: { user_id: userId, provider } },
    select: { access_token: true, refresh_token: true, expires_at: true },
  });
}

// ─── provider config + shared core ──────────────────────────────────────
type ProviderConfig = {
  provider: string;
  /** Events collection URL; the event id is appended for PATCH/DELETE. */
  eventsUrl: string;
  buildPayload: (ev: CalendarEvent) => Record<string, unknown>;
  tokenUrl: () => string;
  refreshForm: (refreshToken: string) => URLSearchParams;
  /** Microsoft rotates refresh tokens on refresh; Google does not. */
  rotatesRefreshToken: boolean;
};

/**
 * Returns a usable access token, refreshing + persisting if it's within 60s of
 * expiry. Returns null (no write should happen) when the token is expired and
 * there's no refresh_token, or the refresh call fails.
 */
async function ensureFresh(
  cfg: ProviderConfig,
  userId: string,
  tok: TokenRow
): Promise<string | null> {
  if (tok.expires_at.getTime() - Date.now() > 60_000) {
    return tok.access_token;
  }
  if (!tok.refresh_token) {
    console.warn(
      `calendar: ${cfg.provider} token expired and no refresh_token for user ${userId} — reconnect needed`
    );
    return null;
  }
  const res = await http()(cfg.tokenUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: cfg.refreshForm(tok.refresh_token).toString(),
  });
  if (!res.ok) {
    console.warn(`calendar: ${cfg.provider} token refresh failed for user ${userId}: ${res.status}`);
    return null;
  }
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) return null;
  const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000);
  await prisma.oauth_tokens.update({
    where: { user_id_provider: { user_id: userId, provider: cfg.provider } },
    data: {
      access_token: data.access_token,
      expires_at: expiresAt,
      updated_at: new Date(),
      ...(cfg.rotatesRefreshToken && data.refresh_token
        ? { refresh_token: data.refresh_token }
        : {}),
    },
  });
  return data.access_token;
}

async function writeEvent(
  cfg: ProviderConfig,
  userId: string,
  ev: CalendarEvent,
  accessToken: string
): Promise<void> {
  const externalId = await loadMapping(userId, cfg.provider, ev.internalUid);
  const method = externalId ? "PATCH" : "POST";
  const url = externalId ? `${cfg.eventsUrl}/${externalId}` : cfg.eventsUrl;

  const res = await http()(url, {
    method,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(cfg.buildPayload(ev)),
  });

  // The mapped event was deleted in the provider directly → drop the stale
  // mapping and re-insert as a fresh POST.
  if (externalId && res.status === 404) {
    await deleteMapping(userId, cfg.provider, ev.internalUid);
    return writeEvent(cfg, userId, ev, accessToken);
  }
  if (!res.ok) {
    throw new Error(`${cfg.provider} ${method} returned ${res.status}: ${await safeText(res)}`);
  }
  const out = (await res.json()) as { id?: string };
  if (out.id) {
    await saveMapping(userId, cfg.provider, ev.internalUid, out.id);
  }
}

async function upsertEvent(
  cfg: ProviderConfig,
  userId: string,
  ev: CalendarEvent
): Promise<void> {
  const tok = await loadToken(userId, cfg.provider);
  if (!tok) return; // not connected → best-effort no-op (zero HTTP)
  const accessToken = await ensureFresh(cfg, userId, tok);
  if (!accessToken) return; // expired + unrefreshable → no-op
  await writeEvent(cfg, userId, ev, accessToken);
}

async function deleteEvent(
  cfg: ProviderConfig,
  userId: string,
  internalUid: string
): Promise<void> {
  const externalId = await loadMapping(userId, cfg.provider, internalUid);
  if (!externalId) return;
  const tok = await loadToken(userId, cfg.provider);
  if (!tok) return;
  const accessToken = await ensureFresh(cfg, userId, tok);
  if (!accessToken) return;

  const res = await http()(`${cfg.eventsUrl}/${externalId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  // 404/410 mean it's already gone — treat as success and drop the mapping.
  if (res.ok || res.status === 404 || res.status === 410) {
    await deleteMapping(userId, cfg.provider, internalUid);
    return;
  }
  throw new Error(`${cfg.provider} DELETE returned ${res.status}: ${await safeText(res)}`);
}

function makeProvider(cfg: ProviderConfig): CalendarProvider {
  return {
    provider: cfg.provider,
    upsert: (userId, ev) => upsertEvent(cfg, userId, ev),
    delete: (userId, internalUid) => deleteEvent(cfg, userId, internalUid),
  };
}

// ─── Google ─────────────────────────────────────────────────────────────
function formatAllDay(d: Date): string {
  // YYYY-MM-DD in UTC — closing/due dates are date-only, parsed as UTC midnight.
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

const googleConfig: ProviderConfig = {
  provider: "google_calendar",
  eventsUrl: "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  buildPayload: googlePayload,
  tokenUrl: () => "https://oauth2.googleapis.com/token",
  refreshForm: (refreshToken) =>
    new URLSearchParams({
      client_id: env().GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env().GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  rotatesRefreshToken: false,
};

export const googleProvider: CalendarProvider = makeProvider(googleConfig);

// ─── Microsoft Graph (Outlook / Office 365) ─────────────────────────────
function microsoftPayload(ev: CalendarEvent): Record<string, unknown> {
  const body: Record<string, unknown> = { subject: ev.summary, isAllDay: ev.allDay };
  if (ev.description) body.body = { contentType: "text", content: ev.description };
  if (ev.location) body.location = { displayName: ev.location };
  if (ev.allDay) {
    // Microsoft requires midnight–midnight (UTC) for all-day events.
    body.start = { dateTime: `${formatAllDay(ev.start)}T00:00:00`, timeZone: "UTC" };
    body.end = { dateTime: `${formatAllDay(ev.end)}T00:00:00`, timeZone: "UTC" };
  } else {
    body.start = { dateTime: ev.start.toISOString().slice(0, 19), timeZone: "UTC" };
    body.end = { dateTime: ev.end.toISOString().slice(0, 19), timeZone: "UTC" };
  }
  return body;
}

const microsoftConfig: ProviderConfig = {
  provider: "microsoft_calendar",
  eventsUrl: "https://graph.microsoft.com/v1.0/me/events",
  buildPayload: microsoftPayload,
  tokenUrl: () =>
    `https://login.microsoftonline.com/${env().MICROSOFT_OAUTH_TENANT || "common"}/oauth2/v2.0/token`,
  refreshForm: (refreshToken) =>
    new URLSearchParams({
      client_id: env().MICROSOFT_OAUTH_CLIENT_ID,
      client_secret: env().MICROSOFT_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: "Calendars.ReadWrite offline_access User.Read",
    }),
  rotatesRefreshToken: true,
};

export const microsoftProvider: CalendarProvider = makeProvider(microsoftConfig);

// ─── fan-out across connected providers ─────────────────────────────────
function providers(): CalendarProvider[] {
  return [googleProvider, microsoftProvider];
}

/**
 * Upsert to every connected calendar. Every provider is ATTEMPTED (one failing
 * never blocks the other), then any collected failure is rethrown so the
 * durable queue (lib/queue.ts) can retry the job with backoff. Retrying a
 * partially-succeeded fan-out is safe: the provider that succeeded just gets
 * an idempotent PATCH of the same event (calendar_event_map).
 *
 * Mutation-path callers stay best-effort — lib/jobs.ts swallows the inline
 * failure and leaves the job queued for the cron sweep.
 */
export async function fanOutUpsert(userId: string, ev: CalendarEvent): Promise<void> {
  const errors: unknown[] = [];
  for (const p of providers()) {
    try {
      await p.upsert(userId, ev);
    } catch (err) {
      console.error(`calendar push to ${p.provider} for user ${userId} failed`, err);
      errors.push(err);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, `calendar upsert failed for ${errors.length} provider(s)`);
  }
}

/** Delete from every connected calendar. Same attempt-all-then-throw contract as fanOutUpsert. */
export async function fanOutDelete(userId: string, internalUid: string): Promise<void> {
  const errors: unknown[] = [];
  for (const p of providers()) {
    try {
      await p.delete(userId, internalUid);
    } catch (err) {
      console.error(`calendar delete on ${p.provider} for user ${userId} failed`, err);
      errors.push(err);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, `calendar delete failed for ${errors.length} provider(s)`);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}
