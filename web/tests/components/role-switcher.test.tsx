// @vitest-environment happy-dom
/**
 * Regression test for issue #104 — the dev RoleSwitcher overlay used z-[9999],
 * which floated it above every modal (modals all use `fixed inset-0 z-50`).
 * On /agent/pipeline the switcher covered the New Deal modal's Purchase Price /
 * Close Date fields and its error message. The switcher must render BELOW the
 * z-50 modal layer so modals sit on top of it.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { RoleSwitcher } from "@/components/RoleSwitcher";

// next/navigation + the auth store throw outside their providers — stub both so
// the component renders in isolation.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/store/authStore", () => ({
  useAuthStore: () => ({
    activeUser: { id: "agent-sarah", name: "Sarah Johnson", role: "Agent", groupId: "agent" },
    setActiveUser: vi.fn(),
  }),
}));

// Every modal in the app renders at `fixed inset-0 z-50`.
const MODAL_LAYER_Z = 50;

function zClass(el: Element | null): string | undefined {
  if (!el) return undefined;
  return [...el.classList].find((c) => /^z-/.test(c));
}
function zValue(cls: string): number {
  const m = cls.match(/(\d+)/);
  return m ? Number(m[1]) : NaN;
}

describe("RoleSwitcher (issue #104 — z-index below the modal layer)", () => {
  it("renders the expanded overlay below z-50 (not z-[9999])", () => {
    const { container } = render(<RoleSwitcher />);
    // The outer panel is the only element carrying the inline min-width:220px.
    const panel = container.querySelector('[style*="220px"]');
    expect(panel).toBeTruthy();

    const z = zClass(panel);
    expect(z).toBeDefined();
    expect(z).not.toBe("z-[9999]");
    expect(zValue(z!)).toBeLessThan(MODAL_LAYER_Z);
  });
});
