import { expect, test, type Page } from "@playwright/test";

const password = process.env.SEED_USER_PASSWORD;
if (!password) throw new Error("E2E tests require SEED_USER_PASSWORD.");

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname !== "/sign-in");
}

test("administrator can reach deterministic forecast operations", async ({ page }) => {
  await signIn(page, "admin@harbor-pantry.example.test");
  await page.goto("/app/harbor-community-food-pantry/forecast");
  await expect(page.getByRole("heading", { name: /Operations forecast/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Recalculate" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Expiration risk" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Donation needs" })).toBeVisible();
});

test("read-only viewer cannot configure forecasts", async ({ page }) => {
  await signIn(page, "viewer@harbor-pantry.example.test");
  await page.goto("/app/harbor-community-food-pantry/forecast");
  await expect(page.getByRole("heading", { name: /Operations forecast/ })).toBeVisible();
  await page.goto("/app/harbor-community-food-pantry/forecast/settings");
  await expect(page.getByRole("heading", { name: "Page unavailable" })).toBeVisible();
});
