/**
 * Issue #298 — GET /api/me/calendar-url must return { feed_url, webcal_url }.
 *
 * CalendarPage's Subscribe / Copy-URL / .ics controls read `webcal_url` and
 * `feed_url` off this response, but the route historically returned only
 * `{ url, token }`, so every control resolved to `undefined`. This pins the
 * new contract: a `webcal://` subscribe URL and an `https://` feed URL, while
 * keeping the legacy `url`/`token` keys for backward compatibility.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { GET as calendarUrlRoute } from "@/app/api/me/calendar-url/route";
import { setVerifyOptionsForTesting } from "@/lib/auth";
import { authHeader, getTestSigner } from "../helpers/jwt";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/factories";

beforeAll(async () => {
  const { verifyOpts } = await getTestSigner();
  setVerifyOptionsForTesting(verifyOpts);
});

beforeEach(async () => {
  await truncateAll();
});

async function calendarUrlReq(base = "https://app.realtourflow.com") {
  return new Request(`${base}/api/me/calendar-url`, {
    headers: { authorization: await authHeader("auth0|a", ["agent"]) },
  });
}

describe("GET /api/me/calendar-url (issue #298)", () => {
  it("returns a webcal:// subscribe URL and an https:// feed URL", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });

    const res = await calendarUrlRoute(await calendarUrlReq());
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      feed_url: string;
      webcal_url: string;
      url: string;
      token: string;
    };

    // The subscribe control opens webcal:// so the OS hands it to the
    // default calendar app.
    expect(body.webcal_url).toMatch(/^webcal:\/\//);
    expect(body.webcal_url).toMatch(
      /^webcal:\/\/app\.realtourflow\.com\/api\/calendar\/[a-f0-9]{48}\/feed\.ics$/,
    );

    // The .ics download uses the plain https:// feed URL.
    expect(body.feed_url).toMatch(/^https:\/\//);
    expect(body.feed_url).toMatch(
      /^https:\/\/app\.realtourflow\.com\/api\/calendar\/[a-f0-9]{48}\/feed\.ics$/,
    );

    // webcal_url is the feed_url with only the scheme swapped.
    expect(body.webcal_url).toBe(body.feed_url.replace(/^https:\/\//, "webcal://"));
  });

  it("keeps the legacy url/token keys for backward compatibility", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });

    const res = await calendarUrlRoute(await calendarUrlReq());
    const body = (await res.json()) as { url: string; token: string; feed_url: string };

    expect(body.url).toBe(body.feed_url);
    expect(body.token).toHaveLength(48);
  });

  it("swaps http:// to webcal:// for a non-TLS origin (local dev)", async () => {
    await createUser({ role: "agent", auth0_id: "auth0|a" });

    const res = await calendarUrlRoute(await calendarUrlReq("http://localhost:3000"));
    const body = (await res.json()) as { feed_url: string; webcal_url: string };

    expect(body.feed_url).toMatch(/^http:\/\/localhost:3000\//);
    expect(body.webcal_url).toMatch(/^webcal:\/\/localhost:3000\//);
  });
});
