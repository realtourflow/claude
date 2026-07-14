// @vitest-environment happy-dom
/**
 * Issue #304 — the admin Users section must let an admin VIEW pending/claimed
 * agent invites (GET /admin/agent-invites) and REVOKE an unclaimed one
 * (DELETE /admin/agent-invites/:id). Before this ticket the list/revoke
 * endpoints were backend-only — nothing in the UI called them.
 *
 * These render the real UserManagement section with only the network boundary
 * (@/lib/api-client) mocked, so the useAgentInvites hook + table wiring are
 * exercised end-to-end.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const apiGet = vi.fn();
const apiDelete = vi.fn();
vi.mock("@/lib/api-client", () => ({
  api: {
    get: (...a: unknown[]) => apiGet(...a),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: (...a: unknown[]) => apiDelete(...a),
  },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

import { UserManagement } from "@/components/pages/admin/AdminDashboard";

// The GET /admin/agent-invites response shape (snake_case, `claimed` boolean).
const PENDING = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "pending@example.com",
  name: "Pending Pat",
  token: "tok-pending",
  invited_by: "99999999-9999-9999-9999-999999999999",
  claimed: false,
  expires_at: "2026-12-31T00:00:00.000Z",
  created_at: "2026-07-01T00:00:00.000Z",
};
const CLAIMED = {
  id: "22222222-2222-2222-2222-222222222222",
  email: "claimed@example.com",
  name: "Claimed Casey",
  token: "tok-claimed",
  invited_by: "99999999-9999-9999-9999-999999999999",
  claimed: true,
  expires_at: "2026-12-31T00:00:00.000Z",
  created_at: "2026-06-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockImplementation(async (path: string) => {
    if (path === "/admin/agent-invites") return [PENDING, CLAIMED];
    if (path === "/users") return [];
    return [];
  });
  apiDelete.mockResolvedValue({ ok: true });
});

function renderUM(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Admin agent-invite list (#304)", () => {
  it("Case 1 — lists a pending agent invite from GET /admin/agent-invites", async () => {
    renderUM(<UserManagement />);

    expect(await screen.findByText("pending@example.com")).toBeInTheDocument();
    // The GET was actually requested.
    expect(apiGet).toHaveBeenCalledWith("/admin/agent-invites");
  });

  it("Case 2 — Revoke on an unclaimed invite calls DELETE and removes the row", async () => {
    const user = userEvent.setup();
    renderUM(<UserManagement />);

    const pendingEmail = await screen.findByText("pending@example.com");
    const row = pendingEmail.closest("tr");
    expect(row).not.toBeNull();

    const revokeBtn = within(row as HTMLElement).getByRole("button", { name: /revoke/i });
    await user.click(revokeBtn);

    expect(apiDelete).toHaveBeenCalledWith(`/admin/agent-invites/${PENDING.id}`);
    await waitFor(() =>
      expect(screen.queryByText("pending@example.com")).not.toBeInTheDocument()
    );
  });

  it("Case 3 — a claimed invite has no Revoke action", async () => {
    renderUM(<UserManagement />);

    const claimedEmail = await screen.findByText("claimed@example.com");
    const row = claimedEmail.closest("tr");
    expect(row).not.toBeNull();

    expect(
      within(row as HTMLElement).queryByRole("button", { name: /revoke/i })
    ).toBeNull();
  });
});
