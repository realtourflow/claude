// @vitest-environment happy-dom
/**
 * Regression test for issue #102 — hydration mismatch on the root page.
 *
 * Providers gates its entire client-only stack (Auth0Provider + the dev
 * RoleSwitcher) behind a post-mount flag, so the server render and the first
 * client render both emit just `children`. The previous code read
 * `window.location.origin` in a useState initializer, so the client's first
 * render injected the RoleSwitcher subtree that the server never produced —
 * a hydration mismatch.
 *
 * A server render (no effects run → mount flag stays false) must therefore
 * contain the children but NOT the client-only RoleSwitcher. The buggy version
 * read `window` (defined under happy-dom), rendered the full stack here, and
 * would either leak "Viewing as" into the markup or throw reaching useRouter —
 * so this test fails on the regression and passes on the fix.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Providers } from "@/components/Providers";

describe("Providers (issue #102 — no client-only stack on the server render)", () => {
  it("server-renders only children, not the dev RoleSwitcher", () => {
    const html = renderToStaticMarkup(
      <Providers>
        <p>app-root</p>
      </Providers>,
    );
    expect(html).toContain("app-root");
    // The dev RoleSwitcher ("DEV: Viewing as") is client-only; if it shows up in
    // the server markup the client/server trees diverge → hydration mismatch.
    expect(html).not.toMatch(/viewing as/i);
  });
});
