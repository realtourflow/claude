import { test, expect, type Page } from "@playwright/test";
import { seedSession } from "./helpers/session";

/**
 * Mobile-responsive layout E2E (#86 / T18). The agent shell was desktop-only
 * (a fixed w-56 sidebar inside h-screen overflow-hidden); on a phone the sidebar
 * ate most of the screen. This proves the golden path runs on a 390px viewport:
 * the nav collapses to a hamburger drawer and Pipeline/DealDetail never scroll
 * horizontally.
 */

const MOBILE = { width: 390, height: 844 };

// Assert the document never extends past the viewport width (allowing 1px of
// sub-pixel rounding). A failure means something forces horizontal scroll.
async function expectNoHorizontalOverflow(page: Page, where: string) {
  const { scrollWidth, inner } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(
    scrollWidth,
    `horizontal overflow on ${where}: scrollWidth ${scrollWidth} > viewport ${inner}`
  ).toBeLessThanOrEqual(inner + 1);
}

test.describe("mobile agent layout (390px)", () => {
  test.use({ viewport: MOBILE });

  test("golden path runs on a phone via the hamburger drawer, no horizontal scroll", async ({
    page,
  }) => {
    await seedSession(page, { role: "agent", name: "E2E Mobile Agent" });

    // 1. Dashboard — the hamburger replaces the sidebar; no overflow.
    await page.goto("/agent");
    const hamburger = page.getByRole("button", { name: "Open navigation" });
    await expect(hamburger).toBeVisible();
    await expectNoHorizontalOverflow(page, "dashboard");

    // 2. The drawer opens, navigates, and slides away after navigation. The
    //    panel stays in the DOM (translated), so assert its on/off-screen
    //    position rather than visibility.
    const drawer = page.getByRole("dialog", { name: "Navigation menu" });
    await hamburger.click();
    await expect
      .poll(async () => (await drawer.boundingBox())?.x ?? -999)
      .toBeGreaterThanOrEqual(0);

    await drawer.getByRole("link", { name: "Pipeline" }).click();
    await expect(page).toHaveURL(/\/agent\/pipeline/);
    await expect
      .poll(async () => (await drawer.boundingBox())?.x ?? -999)
      .toBeLessThan(0);
    await expectNoHorizontalOverflow(page, "pipeline");

    // 3. Create a deal through the (full-width) New Deal modal.
    const clientName = `E2E Mobile ${Date.now()}`;
    await page.getByRole("button", { name: "New Deal" }).click();
    await page.getByPlaceholder("e.g. Jane Doe").fill(clientName);
    await page.getByPlaceholder("350,000").fill("425,000");
    await expectNoHorizontalOverflow(page, "new-deal modal");
    await page.getByRole("button", { name: "Create Deal" }).click();
    await expect(page.getByText("Deal Created")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();

    // 4. Open the deal and advance the stage — DealDetail must not overflow.
    const card = page.getByRole("link").filter({ hasText: clientName });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/\/agent\/deals\//);
    await expectNoHorizontalOverflow(page, "deal detail");

    await page.getByRole("button", { name: "Active Search" }).click();
    await page.getByRole("button", { name: "Confirm & Advance" }).click();
    await expect(page.getByRole("button", { name: "Offer Active" })).toBeVisible();
    await expectNoHorizontalOverflow(page, "deal detail after advance");
  });
});

test.describe("desktop agent layout (unchanged)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("keeps the persistent sidebar and hides the hamburger", async ({ page }) => {
    await seedSession(page, { role: "agent", name: "E2E Desktop Agent" });
    await page.goto("/agent");

    // The persistent sidebar nav is visible; the mobile hamburger is not.
    await expect(
      page.getByRole("complementary").getByRole("link", { name: "Pipeline" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open navigation" })
    ).toBeHidden();
  });
});
