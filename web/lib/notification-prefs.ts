/**
 * #292 — email-notification preference lookup.
 *
 * The Settings → Notifications "Email notifications" toggle persists into
 * `user_settings.settings.notifications.email` (a boolean) via
 * `PUT /api/me/settings` — see NotificationsSection in
 * `components/pages/settings/SettingsPage.tsx`. This module is the single place
 * the notification-email helpers read that key before sending, so flipping the
 * toggle off actually stops the emails.
 *
 * DEFAULT-ON. A missing settings row, a missing `notifications` object, or a
 * missing `email` key all mean "not yet configured" — which matches the
 * Settings UI default (`NOTIFICATION_DEFAULTS.email = true`) and stays opted-in.
 * Only an explicit `email === false` opts the user out.
 */
import { prisma } from "./db";

/**
 * Safely read `settings.notifications.email` out of the free-form JSONB blob.
 * Anything that isn't an explicit boolean `false` is treated as opted-in.
 */
function readEmailPref(settings: unknown): boolean {
  if (settings && typeof settings === "object") {
    const notifications = (settings as Record<string, unknown>).notifications;
    if (notifications && typeof notifications === "object") {
      const email = (notifications as Record<string, unknown>).email;
      if (typeof email === "boolean") return email;
    }
  }
  return true; // default-on
}

/**
 * Whether email notifications are enabled for a single user. Defaults to `true`
 * when the row or the key is absent.
 */
export async function emailNotificationsEnabled(userId: string): Promise<boolean> {
  if (!userId) return true;
  const row = await prisma.user_settings.findUnique({
    where: { user_id: userId },
    select: { settings: true },
  });
  return readEmailPref(row?.settings);
}

/**
 * Batch variant for a fan-out — one query for many recipients. Returns a map
 * from userId → enabled with EVERY requested id present (defaulting to `true`),
 * so a caller can gate with a simple `map.get(id) === false` skip.
 */
export async function emailNotificationsEnabledFor(
  userIds: string[]
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  const unique = [...new Set(userIds.filter(Boolean))];
  for (const id of unique) result.set(id, true); // default-on for every requested id
  if (unique.length === 0) return result;

  const rows = await prisma.user_settings.findMany({
    where: { user_id: { in: unique } },
    select: { user_id: true, settings: true },
  });
  for (const row of rows) result.set(row.user_id, readEmailPref(row.settings));
  return result;
}
