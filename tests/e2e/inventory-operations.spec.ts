import { expect, test, type Page } from "@playwright/test";

const password = process.env.SEED_USER_PASSWORD;
if (!password) throw new Error("E2E tests require SEED_USER_PASSWORD and the fictional local seed.");

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname !== "/sign-in");
}

test("administrator receives a donation through the immutable ledger", async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const donationNumber = `DON-E2E-${suffix}`;
  const lotNumber = `WATER-E2E-${suffix}`;
  await signIn(page, "admin@harbor-pantry.example.test");
  await page.goto("/app/harbor-community-food-pantry/inventory/receiving");
  await expect(page.getByRole("heading", { name: /Receiving · Downtown Pantry/ })).toBeVisible();

  const donationForm = page.getByRole("heading", { name: "Create donation intake" }).locator("..").locator("form");
  await donationForm.getByLabel("Donation number").fill(donationNumber);
  const donationResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/inventory/receiving"));
  await donationForm.getByRole("button", { name: "Create intake" }).click();
  expect((await donationResponse).ok()).toBe(true);
  await page.reload();

  const receivingForm = page.getByRole("heading", { name: "Start receiving" }).locator("..").locator("form");
  await receivingForm.locator('select[name="sourceType"]').selectOption("donation");
  const donationSelect = receivingForm.locator('select[name="donationId"]');
  const donationOption = donationSelect.locator("option").filter({ hasText: donationNumber });
  await donationSelect.selectOption((await donationOption.getAttribute("value"))!);
  const startResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/inventory/receiving"));
  await receivingForm.getByRole("button", { name: "Start session" }).click();
  expect((await startResponse).ok()).toBe(true);
  await page.reload();

  const row = page.locator("tr").filter({ hasText: donationNumber });
  await row.getByRole("link").click();
  const lineForm = page.getByRole("heading", { name: "Add line" }).locator("..").locator("form");
  await lineForm.locator('select[name="itemId"]').selectOption({ label: "Bottled water (16 oz)" });
  await lineForm.getByLabel("Quantity").fill("5");
  await lineForm.locator('select[name="unitId"]').selectOption({ label: "Bottled water (16 oz) · ea" });
  await lineForm.getByLabel("Lot number").fill(lotNumber);
  const detailPath = new URL(page.url()).pathname;
  const lineResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === detailPath);
  await lineForm.getByRole("button", { name: "Add receiving line" }).click();
  expect((await lineResponse).ok()).toBe(true);
  await page.reload();
  await expect(page.getByText(lotNumber)).toBeVisible();
  const completionResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === detailPath);
  await page.getByRole("button", { name: "Complete and post inventory" }).click();
  expect((await completionResponse).ok()).toBe(true);
  await page.reload();
  await expect(page.getByText("donation · completed")).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("volunteer cannot reach receiving or inventory write controls", async ({ page }) => {
  await signIn(page, "volunteer@harbor-pantry.example.test");
  await page.goto("/app/harbor-community-food-pantry/inventory/receiving");
  await expect(page.getByRole("heading", { name: "Page unavailable" })).toBeVisible();
  await page.goto("/app/harbor-community-food-pantry/inventory/adjustments");
  await expect(page.getByRole("button", { name: /submit|approve|reject/i })).toHaveCount(0);
});
