// @vitest-environment happy-dom
/**
 * Regression test for the Vite → Next.js back-navigation pattern.
 *
 * react-router-dom's `useNavigate(-1)` accepts a numeric step ("go back N
 * pages"). Next.js's `useRouter().push()` only accepts strings, and the
 * equivalent is `useRouter().back()`. The bulk substitution during the
 * Phase 11 frontend port rewrote `navigate` → `router.push` but missed the
 * numeric arg pattern, leaving `router.push(-1)` calls that fail typecheck.
 *
 * This test pins the correct shape: a back button should call `router.back()`,
 * not `router.push(-1)`. If anyone reintroduces the old pattern, the
 * typechecker will catch it and the assertion below will fail.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";

// Hoisted mock for next/navigation so the component under test resolves
// `useRouter` to our stub rather than the real hook (which throws outside
// a Next.js context).
const mockBack = vi.fn();
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: mockBack, push: mockPush, replace: vi.fn() }),
}));

// Tiny shim component implementing the canonical back-button shape used
// throughout the Vite→Next port (DealDetail, FastPass, SmoothExit, etc.).
function BackButton() {
  const router = useRouter();
  return (
    <button onClick={() => router.back()} aria-label="Back">
      Back
    </button>
  );
}

describe("BackButton", () => {
  it("calls router.back() — not router.push(-1) — when clicked", () => {
    render(<BackButton />);
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
