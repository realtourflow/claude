// @vitest-environment happy-dom
/**
 * Issue #174 — an authenticated user opening someone else's invite link
 * (typically the inviting agent "seeing what the client sees") must get a
 * clear warning that the invite is bound to a different email. The server
 * rejects the claim either way; this is the UX half.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import InvitePage from "@/components/pages/invite/InvitePage";

const invite = {
  token: "11111111-1111-4111-8111-111111111111",
  deal_id: "22222222-2222-4222-8222-222222222222",
  email: "client@example.com",
  name: "Invited Client",
  role: "buyer" as const,
  agent_name: "Agent Smith",
  deal_title: "123 Main St",
  expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  claimed: false,
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

describe("InvitePage — email mismatch warning (#174)", () => {
  it("warns when the logged-in user's email differs from the invite email", () => {
    auth0State.isAuthenticated = true;
    auth0State.user = { email: "agent@brokerage.com" };

    render(<InvitePage />);
    const warning = screen.getByTestId("invite-email-mismatch");
    expect(warning.textContent).toContain("agent@brokerage.com");
    expect(warning.textContent).toContain("client@example.com");
  });

  it("shows no warning when the logged-in email matches the invite email (case-insensitive)", () => {
    auth0State.isAuthenticated = true;
    auth0State.user = { email: "Client@Example.com" };

    render(<InvitePage />);
    expect(screen.queryByTestId("invite-email-mismatch")).toBeNull();
  });

  it("shows no warning when not authenticated", () => {
    render(<InvitePage />);
    expect(screen.queryByTestId("invite-email-mismatch")).toBeNull();
  });
});
