import { expect, test, type Page } from "@playwright/test";

const password = process.env.SEED_USER_PASSWORD;
if (!password)
  throw new Error(
    "E2E tests require SEED_USER_PASSWORD and the fictional local seed.",
  );

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname !== "/sign-in");
}

test("administrator can reach foundation administration", async ({ page }) => {
  await signIn(page, "admin@harbor-pantry.example.test");
  await expect(page).toHaveURL(/harbor-community-food-pantry\/dashboard/);
  await page.goto("/app/harbor-community-food-pantry/team");
  await expect(page.getByRole("heading", { name: "Members and access" })).toBeVisible();
  await page.goto("/app/harbor-community-food-pantry/audit");
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
});

test("administrator can create a location and prepare an invitation", async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000);
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const locationName = `Eastside E2E ${suffix}`;
  await signIn(page, "admin@harbor-pantry.example.test");
  await page.goto("/app/harbor-community-food-pantry/locations/new");
  await page.getByLabel("Location name").fill(locationName);
  await page.getByLabel("Location slug").fill(`eastside-e2e-${suffix}`);
  const createResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/locations/new"));
  await page.getByRole("button", { name: "Create location" }).click();
  expect((await createResponse).ok()).toBe(true);
  await page.goto("/app/harbor-community-food-pantry/locations");
  await expect(page.getByRole("heading", { name: locationName })).toBeVisible();

  await page.goto("/app/harbor-community-food-pantry/team");
  const invitationForm = page.locator("form").filter({ has: page.getByRole("heading", { name: "Prepare invitation" }) });
  const invitationEmail = `invite-${suffix}@example.test`;
  await invitationForm.getByRole("textbox", { name: "Email address" }).fill(invitationEmail);
  await invitationForm.locator('select[name="roleId"]').selectOption({ label: "Read-only viewer · organization" });
  const invitationResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/team"));
  await invitationForm.getByRole("button", { name: "Prepare invitation" }).click();
  expect((await invitationResponse).ok()).toBe(true);
  await page.goto("/app/harbor-community-food-pantry/team");
  await expect(page.getByText(invitationEmail)).toBeVisible();
});

test("pantry manager cannot reach organization security settings", async ({
  page,
}) => {
  await signIn(page, "manager@harbor-pantry.example.test");
  await expect(page.getByRole("link", { name: "Organization" })).toHaveCount(0);
  await page.goto("/app/harbor-community-food-pantry/settings");
  await expect(
    page.getByRole("heading", { name: "Page unavailable" }),
  ).toBeVisible();
});

test("volunteer has limited navigation and cannot call admin UI", async ({
  page,
}) => {
  await signIn(page, "volunteer@harbor-pantry.example.test");
  await expect(page.getByRole("link", { name: "Team", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Organization" })).toHaveCount(0);
  await page.goto("/app/harbor-community-food-pantry/team");
  await expect(
    page.getByRole("heading", { name: "Page unavailable" }),
  ).toBeVisible();
});

test("read-only viewer has no write controls", async ({ page }) => {
  await signIn(page, "viewer@harbor-pantry.example.test");
  await page.goto("/app/harbor-community-food-pantry/locations");
  await expect(
    page.getByRole("button", { name: /create|save|archive/i }),
  ).toHaveCount(0);
});

test("suspended user receives the access-blocked state", async ({ page }) => {
  await signIn(page, "suspended@harbor-pantry.example.test");
  await expect(page).toHaveURL(/access-blocked/);
  await expect(
    page.getByRole("heading", { name: "Access is blocked" }),
  ).toBeVisible();
});

test("cross-organization slug guessing does not reveal data", async ({
  page,
}) => {
  await signIn(page, "volunteer@harbor-pantry.example.test");
  await page.goto("/app/riverside-mutual-aid-pantry/dashboard");
  await expect(
    page.getByRole("heading", { name: "Page unavailable" }),
  ).toBeVisible();
});

test("new user can sign up and complete atomic onboarding", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const organizationName = `E2E Community Pantry ${suffix}`;
  const organizationSlug = `e2e-community-pantry-${suffix}`;
  await page.goto("/sign-up");
  await page.getByLabel("Display name").fill(`E2E Administrator ${suffix}`);
  await page.getByLabel("Email address").fill(`new-admin-${suffix}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill(password!);
  await page.getByLabel("Confirm password").fill(password!);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/onboarding");

  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Organization name").fill(organizationName);
  await page.getByLabel("Organization slug").fill(organizationSlug);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Location name").fill("Main Pantry");
  await page.getByLabel("Location slug").fill("main-pantry");
  await page.getByRole("button", { name: "Continue" }).click();
  const shouldSubmit = await Promise.race([
    page.waitForURL(`**/app/${organizationSlug}/dashboard`).then(() => false),
    page.getByRole("button", { name: "Create organization" }).waitFor().then(() => true),
  ]);
  if (shouldSubmit) await page.getByRole("button", { name: "Create organization" }).click();
  await page.waitForURL(`**/app/${organizationSlug}/dashboard`);
  await expect(page.getByRole("heading", { name: organizationName })).toBeVisible();
});
