// @vitest-environment happy-dom
/**
 * Calendar feed "Rotate link" control (issue #297).
 *
 * The agent needs a UI to revoke/rotate their iCal feed token if the
 * webcal URL leaks. CalendarPage gains a "Rotate link" button that POSTs to
 * /me/calendar-url/rotate and re-fetches the URL so the displayed
 * Subscribe/Copy/.ics links point at the new token.
 *
 * normalizeCalUrl keeps the page working whether the GET route returns the
 * legacy { url, token } shape or the richer { feed_url, webcal_url } shape —
 * so this UI does not depend on any concurrent change to the GET response.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/hooks/useDeals", () => ({ useDeals: () => ({ deals: [] }) }));
vi.mock("@/hooks/useTasks", () => ({ useAgentTasks: () => ({ tasks: [] }) }));
vi.mock("@/hooks/useContingencies", () => ({ useAllContingenciesForDeals: () => [] }));

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock("@/lib/api-client", () => ({
  api: {
    get: (...a: unknown[]) => apiGet(...a),
    post: (...a: unknown[]) => apiPost(...a),
  },
}));

import CalendarPage, { normalizeCalUrl } from "@/components/pages/CalendarPage";

beforeEach(() => {
  vi.clearAllMocks();
  // Rotation is destructive; the UI guards it with confirm(). Auto-accept.
  window.confirm = vi.fn(() => true);
});

describe("normalizeCalUrl", () => {
  it("derives webcal_url from the legacy { url } shape", () => {
    expect(
      normalizeCalUrl({ url: "https://app.example.com/api/calendar/tok/feed.ics", token: "tok" })
    ).toEqual({
      feed_url: "https://app.example.com/api/calendar/tok/feed.ics",
      webcal_url: "webcal://app.example.com/api/calendar/tok/feed.ics",
    });
  });

  it("prefers explicit feed_url / webcal_url when the API already provides them", () => {
    expect(
      normalizeCalUrl({
        feed_url: "https://x.io/api/calendar/t/feed.ics",
        webcal_url: "webcal://x.io/api/calendar/t/feed.ics",
        url: "https://x.io/api/calendar/t/feed.ics",
        token: "t",
      })
    ).toEqual({
      feed_url: "https://x.io/api/calendar/t/feed.ics",
      webcal_url: "webcal://x.io/api/calendar/t/feed.ics",
    });
  });

  it("returns null when there is no URL at all", () => {
    expect(normalizeCalUrl(null)).toBeNull();
    expect(normalizeCalUrl({})).toBeNull();
  });
});

describe("CalendarPage rotate control", () => {
  function wireApi() {
    let token = "OLDTOKEN";
    apiGet.mockImplementation((path: string) => {
      if (path === "/me/calendar-url") {
        // Deliberately the legacy { url, token } shape.
        return Promise.resolve({
          url: `http://localhost/api/calendar/${token}/feed.ics`,
          token,
        });
      }
      if (path.startsWith("/me/calendar/events")) return Promise.resolve({ events: [] });
      return Promise.resolve({});
    });
    apiPost.mockImplementation(() => {
      token = "NEWTOKEN"; // subsequent GET now reflects the rotated token
      return Promise.resolve({
        url: `http://localhost/api/calendar/NEWTOKEN/feed.ics`,
        token: "NEWTOKEN",
      });
    });
  }

  it("renders a Rotate link control alongside Subscribe", async () => {
    wireApi();
    render(<CalendarPage />);
    expect(await screen.findByRole("link", { name: /subscribe/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /rotate link/i })).toBeTruthy();
  });

  it("rotating POSTs to the rotate endpoint and re-fetches the new token into the Subscribe link", async () => {
    wireApi();
    render(<CalendarPage />);

    const subscribe = await screen.findByRole("link", { name: /subscribe/i });
    await waitFor(() => expect(subscribe.getAttribute("href")).toContain("OLDTOKEN"));

    fireEvent.click(screen.getByRole("button", { name: /rotate link/i }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/me/calendar-url/rotate", expect.anything())
    );
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: /subscribe/i }).getAttribute("href")
      ).toContain("NEWTOKEN")
    );
  });

  it("does not rotate when the confirm prompt is declined", async () => {
    wireApi();
    (window.confirm as ReturnType<typeof vi.fn>).mockReturnValue(false);
    render(<CalendarPage />);

    await screen.findByRole("link", { name: /subscribe/i });
    fireEvent.click(screen.getByRole("button", { name: /rotate link/i }));

    expect(apiPost).not.toHaveBeenCalled();
  });
});
