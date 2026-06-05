import { test, expect } from "@playwright/test";
import { seedSession } from "./helpers/session";

/**
 * Golden-path E2E (T6-1): the one flow that must work end-to-end in a browser —
 * create a deal, advance its stage, and confirm the new stage survives a reload.
 *
 * Auth is a seeded session (signed test JWT cookie), never a real Auth0 login.
 * The reload step is the crux: the in-memory stage override is wiped on reload,
 * so a persisted stage can only come from the server/DB.
 */
test("golden path: create deal → advance stage → reload persists", async ({
  page,
}) => {
  // 1. Start authenticated.
  await seedSession(page, { role: "agent", name: "E2E Agent" });

  // Unique per run so assertions can't collide with deals left by prior runs.
  const clientName = `E2E Buyer ${Date.now()}`;

  // 2. Create a deal via the UI.
  await page.goto("/agent/pipeline");
  await page.getByRole("button", { name: "New Deal" }).click();
  await page.getByPlaceholder("e.g. Jane Doe").fill(clientName);
  await page.getByPlaceholder("350,000").fill("425,000");
  await page.getByRole("button", { name: "Create Deal" }).click();

  // Creation confirmed; close the modal.
  await expect(page.getByText("Deal Created")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  // …and it shows up in the pipeline.
  const card = page.getByRole("link").filter({ hasText: clientName });
  await expect(card).toBeVisible();

  // 3. Open the deal and advance its stage (Intake → Active Search).
  await card.click();
  // The advance button is labelled with the *next* stage. At Intake that's
  // "Active Search"; its presence confirms we loaded a deal sitting at Intake.
  await page.getByRole("button", { name: "Active Search" }).click();
  await page.getByRole("button", { name: "Confirm & Advance" }).click();

  // Stage advanced: the advance target is now the stage after Active Search.
  await expect(page.getByRole("button", { name: "Offer Active" })).toBeVisible();
  await expect(page.getByText("Active Search").first()).toBeVisible();

  // 4. Reload — wipes the client-side stage override, so the stage shown now is
  //    whatever the server persisted. Still Active Search → it stuck.
  await page.reload();
  await expect(page).toHaveURL(/\/agent\/deals\//);
  await expect(page.getByRole("button", { name: "Offer Active" })).toBeVisible();
  await expect(page.getByText("Active Search").first()).toBeVisible();
});
