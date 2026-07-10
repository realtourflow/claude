// @vitest-environment happy-dom
/**
 * #183 — account-first sellers (authenticated, no invite token) used to reach
 * the Smooth Exit survey with NO dealId: SellerOnboarding only ever set dealId
 * from the /invites/:token lookup, so the default new-seller path
 * (RootRedirect → /onboard/seller) pushed `/smooth-exit/survey?fromOnboarding=true`
 * with no deal to enroll. The onboarding must resolve the seller's sell deal
 * from /me/deals and thread its id into both Smooth Exit links.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SellerOnboarding from "@/components/pages/onboarding/SellerOnboarding";
import { api } from "@/lib/api-client";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(), // account-first: no token, no agent
}));

vi.mock("@/lib/store/authStore", () => ({
  useAuthStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      activeUser: { id: "u-1", name: "Sam Seller", email: "sam@example.com" },
      markOnboardingComplete: vi.fn(),
    }),
}));

vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const mockGet = api.get as Mock;

const SELL_DEAL = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/** Answer every screen (no-mortgage, not-buying path) up to the Smooth Exit pitch. */
async function driveToSmoothExitPitch() {
  // address
  fireEvent.change(
    screen.getByPlaceholderText("123 Oak Lane, Birmingham, AL 35203"),
    { target: { value: "1 Test St, Birmingham, AL" } }
  );
  fireEvent.click(screen.getByText("Continue"));
  // priceExpectation / whatMattersMost / desiredListDate / hardDeadline / flexibility
  fireEvent.click(screen.getByText("I have a number in mind"));
  fireEvent.click(screen.getByText("Certainty of closing"));
  fireEvent.click(screen.getByText("ASAP"));
  fireEvent.click(screen.getByText("No hard deadline"));
  fireEvent.click(screen.getByText("Very flexible"));
  // reasonsForSelling (multi-select, required)
  fireEvent.click(screen.getByText("Downsizing"));
  fireEvent.click(screen.getByText("Continue"));
  // stressfulOrUrgent → no auto-advances
  fireEvent.click(screen.getByText("No — we're good"));
  // hasMortgage → no (skips mortgage screens)
  fireEvent.click(screen.getByText("No"));
  // propertyTax (optional)
  fireEvent.click(screen.getByText("Continue"));
  // propertyType / occupancy
  fireEvent.click(screen.getByText("Single Family"));
  fireEvent.click(screen.getByText("Owner-occupied"));
  // yearBuilt (optional)
  fireEvent.click(screen.getByText("Continue"));
  // conditionRating
  fireEvent.click(screen.getByText("Turn-key / Move-in ready"));
  // knownIssues (optional multi)
  fireEvent.click(screen.getByText("Continue"));
  // majorUpgrades → No auto-advances
  fireEvent.click(screen.getByText("No"));
  // hasHoa → No auto-advances
  fireEvent.click(screen.getByText("No"));
  // preListingPrep (optional multi)
  fireEvent.click(screen.getByText("Continue"));
  // preListingSpend / biggerFear / openToIncentives
  fireEvent.click(screen.getByText("$0 – List as-is"));
  fireEvent.click(screen.getByText("Deal falling apart"));
  fireEvent.click(screen.getByText("Yes, open to it"));
  // alsoLookingToBuy → No (skips buy screens + pitch page)
  fireEvent.click(screen.getByText("No"));
  // Smooth Exit pitch
  await screen.findByText("Smooth Exit");
}

beforeEach(() => {
  mockPush.mockReset();
  mockGet.mockReset();
});

describe("SellerOnboarding account-first Smooth Exit dealId threading", () => {
  it("threads the seller's sell-deal id from /me/deals into the Get Started link", async () => {
    mockGet.mockResolvedValue([
      { id: SELL_DEAL, type: "sell", agent_name: "Alex Agent" },
    ]);
    render(<SellerOnboarding />);
    // Flush the /me/deals fetch before driving the flow.
    await act(async () => {});
    await driveToSmoothExitPitch();

    fireEvent.click(screen.getByText("Get Started"));
    expect(mockPush).toHaveBeenCalledWith(
      `/smooth-exit/survey?fromOnboarding=true&dealId=${SELL_DEAL}`
    );
  });

  it("skips buy deals when resolving which deal to thread", async () => {
    mockGet.mockResolvedValue([
      { id: "99999999-8888-7777-6666-555555555555", type: "buy", agent_name: "Alex Agent" },
      { id: SELL_DEAL, type: "sell", agent_name: "Alex Agent" },
    ]);
    render(<SellerOnboarding />);
    await act(async () => {});
    await driveToSmoothExitPitch();

    fireEvent.click(screen.getByText("Learn more →"));
    expect(mockPush).toHaveBeenCalledWith(
      `/smooth-exit?fromOnboarding=true&dealId=${SELL_DEAL}`
    );
  });
});
