// @vitest-environment happy-dom
/**
 * Agent onboarding captures the agent's COMPANY (from the managed brokerages
 * list, with an "Other" escape hatch) and MARKET(S) (multi-select from the
 * canonical grouped list) on the same step, and persists both to the profile
 * record (PATCH /me/profile) on finish. These tests drive the real
 * AgentOnboarding component through to that PATCH.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AgentOnboarding from "@/components/pages/onboarding/AgentOnboarding";

const apiGet = vi.fn();
const apiPatch = vi.fn().mockResolvedValue({});
const apiPut = vi.fn().mockResolvedValue({});
vi.mock("@/lib/api-client", () => ({
  api: {
    get: (...a: unknown[]) => apiGet(...a),
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
// Onboarding uploads through the Vision pipeline (useAgentForms / FormUploader).
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
  // The managed company dropdown (GET /brokerages).
  apiGet.mockImplementation(async (path: unknown) => {
    if (path === "/brokerages") return ["ARC Realty", "RE/MAX"];
    return [];
  });
});

// Walk from the welcome screen to the Company & Markets step (screen 6).
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

describe("AgentOnboarding — Company & Markets step", () => {
  it("offers the grouped market list + managed company list; requires both", async () => {
    const user = userEvent.setup();
    render(<AgentOnboarding />);
    await gotoMarketStep(user);

    expect(screen.getByText(/Your company & markets/i)).toBeInTheDocument();

    // Markets come from the canonical grouped list (multi-select, no typing).
    expect(screen.getByText("Greater Alabama MLS")).toBeInTheDocument();
    expect(screen.getByText("Lake Markets")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Birmingham Metro/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Huntsville/ })).toBeInTheDocument();

    // Companies come from the managed list (ARC Realty is seeded).
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ARC Realty" })).toBeInTheDocument()
    );

    // Continue is disabled until BOTH at least one market and a company are set.
    const continueBtn = screen.getByRole("button", { name: /^Continue$/i });
    expect(continueBtn).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Birmingham Metro/ }));
    expect(continueBtn).toBeDisabled(); // markets only — still blocked
    await user.click(screen.getByRole("button", { name: "ARC Realty" }));
    expect(continueBtn).toBeEnabled();
  });

  it("persists MULTIPLE markets + the company to the profile record on finish", async () => {
    const user = userEvent.setup();
    render(<AgentOnboarding />);
    await gotoMarketStep(user);

    // Multi-select: two markets from different groups.
    await user.click(screen.getByRole("button", { name: /Baldwin County \/ Gulf Coast/ }));
    await user.click(screen.getByRole("button", { name: /Huntsville/ }));
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

    // DoneScreen fires PATCH /me/profile with markets[] + brokerage.
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith("/me/profile", expect.anything()));
    const profileBody = apiPatch.mock.calls.find((c) => c[0] === "/me/profile")?.[1] as {
      markets: string[];
      brokerage: string;
    };
    expect(profileBody.markets).toEqual(["BALDWIN_GULF_COAST", "HUNTSVILLE"]);
    expect(profileBody.brokerage).toBe("RE/MAX");
  });

  it("'Other' lets the agent type an unlisted company", async () => {
    const user = userEvent.setup();
    render(<AgentOnboarding />);
    await gotoMarketStep(user);

    await user.click(screen.getByRole("button", { name: /Tuscaloosa/ }));
    await user.click(screen.getByRole("button", { name: "Other" }));
    await user.type(
      screen.getByPlaceholderText(/River City Realty/i),
      "Smallville Homes"
    );
    const continueBtn = screen.getByRole("button", { name: /^Continue$/i });
    expect(continueBtn).toBeEnabled();
  });
});
