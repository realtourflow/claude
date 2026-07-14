// @vitest-environment happy-dom
/**
 * Issue #298 — CalendarPage Subscribe / Copy URL / .ics controls.
 *
 * The page reads `webcal_url` (Subscribe href + clipboard) and `feed_url`
 * (.ics download) off GET /api/me/calendar-url. Before the fix the route sent
 * `{ url, token }`, so all three resolved to `undefined`: href={undefined} and
 * navigator.clipboard.writeText(undefined). These tests mock the route with the
 * corrected `{ feed_url, webcal_url }` shape and assert the controls resolve to
 * real, non-empty URLs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// CalendarPage's data hooks are irrelevant here — stub them to empty so the
// page renders only the subscribe controls, not deal/task/contingency rows.
vi.mock("@/hooks/useDeals", () => ({ useDeals: () => ({ deals: [] }) }));
vi.mock("@/hooks/useTasks", () => ({ useAgentTasks: () => ({ tasks: [] }) }));
vi.mock("@/hooks/useContingencies", () => ({
  useAllContingenciesForDeals: () => [],
}));

const apiGet = vi.fn();
vi.mock("@/lib/api-client", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import CalendarPage from "@/components/pages/CalendarPage";

const FEED_URL = "https://app.realtourflow.com/api/calendar/abc123def456/feed.ics";
const WEBCAL_URL = "webcal://app.realtourflow.com/api/calendar/abc123def456/feed.ics";

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  // happy-dom doesn't implement the async clipboard API — install a spy.
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  apiGet.mockImplementation((path: string) => {
    if (path === "/me/calendar-url") {
      return Promise.resolve({ feed_url: FEED_URL, webcal_url: WEBCAL_URL });
    }
    if (path.startsWith("/me/calendar/events")) {
      return Promise.resolve({ events: [] });
    }
    return Promise.resolve({});
  });
});

describe("CalendarPage subscribe controls (issue #298)", () => {
  it("Subscribe href is a non-empty webcal:// URL", async () => {
    render(<CalendarPage />);

    const subscribe = await screen.findByRole("link", { name: /subscribe/i });
    const href = subscribe.getAttribute("href");
    expect(href).toBeTruthy();
    expect(href).not.toBe("undefined");
    expect(href).toMatch(/^webcal:\/\//);
    expect(href).toBe(WEBCAL_URL);
  });

  it("Copy URL writes the real webcal URL to the clipboard", async () => {
    render(<CalendarPage />);

    const copyBtn = await screen.findByRole("button", { name: /copy url/i });
    fireEvent.click(copyBtn);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(WEBCAL_URL);
    // Guard against the original bug: undefined must never reach the clipboard.
    expect(writeText).not.toHaveBeenCalledWith(undefined);
  });

  it(".ics download link points at the https:// feed URL", async () => {
    render(<CalendarPage />);

    const icsLink = await screen.findByRole("link", { name: /\.ics/i });
    const href = icsLink.getAttribute("href");
    expect(href).toBeTruthy();
    expect(href).toBe(FEED_URL);
  });
});
