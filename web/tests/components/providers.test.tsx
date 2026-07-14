// @vitest-environment happy-dom
/**
 * Regression test for issue #102 — hydration mismatch on the root page.
 *
 * Providers gates its entire client-only stack (Auth0Provider etc.) behind a
 * post-mount flag, so the server render and the first client render both emit
 * just `children`. The previous code read `window.location.origin` in a
 * useState initializer, so the client's first render injected a subtree the
 * server never produced — a hydration mismatch.
 *
 * A server render (no effects run → mount flag stays false) must therefore
 * contain the children and nothing else. The buggy version read `window`
 * (defined under happy-dom), rendered the full client-only stack here, and
 * would either leak provider markup or throw reaching useRouter — so this
 * test fails on the regression and passes on the fix.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Providers } from "@/components/Providers";

describe("Providers (issue #102 — no client-only stack on the server render)", () => {
  it("server-renders only the children", () => {
    const html = renderToStaticMarkup(
      <Providers>
        <p>app-root</p>
      </Providers>,
    );
    // Children only — any extra markup means the client-only provider stack
    // rendered on the server, which diverges from the first client render.
    expect(html).toBe("<p>app-root</p>");
  });
});
