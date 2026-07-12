import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const password = process.env.SEED_USER_PASSWORD;
if (!password) throw new Error("E2E tests require SEED_USER_PASSWORD.");

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("admin@harbor-pantry.example.test");
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname !== "/sign-in");
}

test("core operations pages have no WCAG A/AA automated violations", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  for (const path of [
    "/app/harbor-community-food-pantry/dashboard",
    "/app/harbor-community-food-pantry/inventory",
    "/app/harbor-community-food-pantry/pickups",
    "/app/harbor-community-food-pantry/forecast",
    "/app/harbor-community-food-pantry/messages",
    "/app/harbor-community-food-pantry/reports",
    "/app/harbor-community-food-pantry/assistant",
  ]) {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations).toEqual([]);
  }
});
