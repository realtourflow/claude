// @vitest-environment happy-dom
/**
 * Agent onboarding now captures market (drives board forms) + brokerage
 * (informational) on the same step, and persists both to the profile record
 * (PATCH /me/profile) on finish. These tests drive the real AgentOnboarding
 * component through to that PATCH.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AgentOnboarding from "@/components/pages/onboarding/AgentOnboarding";

const apiPatch = vi.fn().mockResolvedValue({});
const apiPut = vi.fn().mockResolvedValue({});
vi.mock("@/lib/api-client", () => ({
  api: {
    patch: (...a: unknown[]) => apiPatch(...a),
    put: (...a: unknown[]) => apiPut(...a),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/store/agentSetupStore", () => ({
  useAgentSetupStore: () => ({ dismissBanner: vi.fn(), bannerDismissed: false }),
}));
vi.mock("@/lib/store/authStore", () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({ markOnboardingComplete: vi.fn(), activeUser: null }),
}));
// Onboarding now uploads through the Vision pipeline (useAgentForms / FormUploader).
vi.mock("@/hooks/useAgentForms", () => ({
  useAgentForms: () => ({
    forms: [],
    loading: false,
    formTypes: [],
    uploadForm: vi.fn(),
    getAttestation: vi.fn(() =>
      Promise.resolve("I attest that I am licensed and permitted to use and host this form.")
    ),
  }),
}));
vi.mock("@/hooks/useAgentPhoto", () => ({ uploadAgentPhoto: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

// Walk from the welcome screen to the Market & Brokerage step (screen 6).
async function gotoMarketStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /build my office/i }));
  await user.type(screen.getByPlaceholderText(/Sarah Johnson/i), "Test Agent");
  await user.click(screen.getByRole("button", { name: /^Continue$/i })); // name
  await user.click(screen.getByRole("button", { name: "Realtor" })); // title (auto-advance)
  await user.type(screen.getByPlaceholderText(/555-0100/), "205-555-0123"); // phone
  await user.click(screen.getByRole("button", { name: /^Continue$/i })); // phone+license
  await user.click(screen.getByRole("button", { name: /Skip for now/i })); // photo
  await user.click(screen.getByRole("button", { name: /Skip for now/i })); // bio
}

describe("AgentOnboarding — Market & Brokerage step", () => {
  it("requires a market and brokerage before continuing", async () => {
    const user = userEvent.setup();
    render(<AgentOnboarding />);
    await gotoMarketStep(user);

    expect(screen.getByText(/Your market & brokerage/i)).toBeInTheDocument();
    // Both markets are offered with friendly labels.
    expect(screen.getByRole("button", { name: "Birmingham" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alabama Gulf Coast" })).toBeInTheDocument();

    // Continue is disabled until BOTH market and brokerage are chosen.
    const continueBtn = screen.getByRole("button", { name: /^Continue$/i });
    expect(continueBtn).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Birmingham" }));
    expect(continueBtn).toBeDisabled(); // market only — still blocked
    await user.click(screen.getByRole("button", { name: "RE/MAX" }));
    expect(continueBtn).toBeEnabled();
  });

  it("persists the chosen market + brokerage to the profile record on finish", async () => {
    const user = userEvent.setup();
    render(<AgentOnboarding />);
    await gotoMarketStep(user);

    await user.click(screen.getByRole("button", { name: "Alabama Gulf Coast" }));
    await user.click(screen.getByRole("button", { name: "RE/MAX" }));
    await user.click(screen.getByRole("button", { name: /^Continue$/i }));

    // Blow through the remaining optional steps to the Done screen.
    await user.click(screen.getByRole("button", { name: /handle it myself/i })); // TC
    await user.click(screen.getByRole("button", { name: /Save messages/i })); // welcome msgs
    await user.click(screen.getByRole("button", { name: /different lender/i })); // lender
    await user.click(screen.getByRole("button", { name: /^Continue$/i })); // notifications
    await user.click(screen.getByRole("button", { name: /None of these/i })); // integrations
    await user.click(screen.getByRole("button", { name: "Continue" })); // documents (no docs)
    await user.click(screen.getByRole("button", { name: /Skip — I/i })); // commission

    // DoneScreen fires PATCH /me/profile with market + brokerage.
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith("/me/profile", expect.anything()));
    const profileBody = apiPatch.mock.calls.find((c) => c[0] === "/me/profile")?.[1] as Record<
      string,
      string
    >;
    expect(profileBody.market).toBe("BALDWIN_GULF_COAST");
    expect(profileBody.brokerage).toBe("RE/MAX");
  });
});
