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

test("administrator can filter, export, and print scoped reports", async ({ page }) => {
  await signIn(page, "admin@harbor-pantry.example.test");
  await page.goto("/app/harbor-community-food-pantry/reports");
  await expect(page.getByRole("heading", { name: /Reports · Downtown Pantry/ })).toBeVisible();
  await page.getByRole("link", { name: /Inventory on hand/ }).click();
  await expect(page.getByRole("heading", { name: /Inventory on hand · Downtown Pantry/ })).toBeVisible();
  await page.getByLabel("From").fill("2026-01-01");
  await page.getByLabel("To").fill("2026-12-31");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/dateFrom=2026-01-01/);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("inventory-on-hand-2026-01-01-2026-12-31.csv");
  await page.goto("/app/harbor-community-food-pantry/reports/expiring-inventory");
  await page.getByRole("link", { name: "Print view" }).click();
  await expect(page.getByRole("heading", { name: "Expiring inventory" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeVisible();
});

test("another organization cannot open or export Harbor reports", async ({ page }) => {
  await signIn(page, "admin@other-pantry.example.test");
  await page.goto("/app/harbor-community-food-pantry/reports");
  await expect(page.getByRole("heading", { name: "Page unavailable" })).toBeVisible();
  const response = await page.request.get("/api/reports/harbor-community-food-pantry/inventory-on-hand?locationId=30000000-0000-4000-8000-000000000001&dateFrom=2026-01-01&dateTo=2026-12-31");
  expect(response.status()).toBe(403);
});

