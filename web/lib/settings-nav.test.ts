import { describe, it, expect } from "vitest";
import { settingsTabFromSearch } from "@/lib/settings-nav";

describe("settingsTabFromSearch", () => {
  it("opens the Integrations tab when returning from an OAuth connect", () => {
    expect(settingsTabFromSearch("?integrations=google_calendar_connected")).toBe(
      "integrations"
    );
    expect(
      settingsTabFromSearch("?integrations=microsoft_calendar_error&reason=invalid_state")
    ).toBe("integrations");
  });

  it("defaults to the Profile tab otherwise", () => {
    expect(settingsTabFromSearch("")).toBe("profile");
    expect(settingsTabFromSearch("?foo=bar")).toBe("profile");
  });
});
