// @vitest-environment happy-dom
/**
 * Issue #224 — an authenticated user opening someone else's agent-invite link
 * (e.g. the admin previewing it, or a buyer who got the link forwarded) must
 * get a clear warning that the invite is bound to a different email. The
 * server rejects the claim for existing non-agent accounts either way; this
 * is the UX half. Mirrors invite-email-mismatch.test.tsx from #174.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import AgentSignupPage from "@/components/pages/agent-signup/AgentSignupPage";

const invite = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "newagent@example.com",
  name: "New Agent",
  token: "11111111-1111-4111-8111-111111111111",
  claimed: false,
  expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
};

const auth0State = {
  isAuthenticated: false,
  isLoading: false,
  user: undefined as { email?: string } | undefined,
  loginWithRedirect: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useParams: () => ({ token: invite.token }),
}));
vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => auth0State,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: invite, isLoading: false, error: null }),
}));

afterEach(() => {
  cleanup();
  auth0State.isAuthenticated = false;
  auth0State.user = undefined;
});

describe("AgentSignupPage — email mismatch warning (#224)", () => {
  it("warns when the logged-in user's email differs from the invite email", () => {
    auth0State.isAuthenticated = true;
    auth0State.user = { email: "buyer@example.com" };

    render(<AgentSignupPage />);
    const warning = screen.getByTestId("agent-invite-email-mismatch");
    expect(warning.textContent).toContain("buyer@example.com");
    expect(warning.textContent).toContain("newagent@example.com");
  });

  it("shows no warning when the logged-in email matches the invite email (case-insensitive)", () => {
    auth0State.isAuthenticated = true;
    auth0State.user = { email: "NewAgent@Example.com" };

    render(<AgentSignupPage />);
    expect(screen.queryByTestId("agent-invite-email-mismatch")).toBeNull();
  });

  it("shows no warning when not authenticated", () => {
    render(<AgentSignupPage />);
    expect(screen.queryByTestId("agent-invite-email-mismatch")).toBeNull();
  });
});
