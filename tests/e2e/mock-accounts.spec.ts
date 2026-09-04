import { expect, test, type Page } from "@playwright/test";

const accounts = {
  owner: "11111111-1111-4111-8111-111111111111",
  planner: "22222222-2222-4222-8222-222222222222",
  member: "33333333-3333-4333-8333-333333333333",
  viewer: "44444444-4444-4444-8444-444444444444",
} as const;

async function signIn(page: Page, account: keyof typeof accounts) {
  await page.goto("/login");
  await page.locator(`button[name="account"][value="${accounts[account]}"]`).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText(`${account}@example.test (${account})`)).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");
}

async function openPlan(page: Page) {
  const planTab = page.getByRole("tab", { name: "Plan" });
  await expect(async () => {
    await planTab.click();
    await expect(planTab).toHaveAttribute("aria-selected", "true");
  }).toPass();
}

test("mock accounts exercise role permissions without Supabase or Gemini", async ({ page }) => {
  const errors: string[] = [];
  const failures: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });

  await page.goto("/login");
  await expect(page.getByText("Use a mock account to try each role.")).toBeVisible();
  await expect(page.locator('button[name="account"]')).toHaveCount(4);

  await signIn(page, "planner");
  await expect(page.getByRole("button", { name: "Save trip" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Generate plan" })).toBeEnabled();
  const proposalResponse = page.waitForResponse((response) =>
    response.url().includes("/proposals") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Generate plan" }).click();
  await expect((await proposalResponse).status()).toBe(201);
  await openPlan(page);
  await expect(page.getByText("Mock proposal for George Town, Penang").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm itinerary" })).toHaveCount(0);
  await signOut(page);

  await signIn(page, "owner");
  await openPlan(page);
  const decisionResponse = page.waitForResponse((response) =>
    response.url().includes("/decision") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Confirm itinerary" }).first().click();
  await expect((await decisionResponse).status()).toBe(200);
  await expect(page.getByText("Active itinerary")).toBeVisible();
  await signOut(page);

  for (const role of ["member", "viewer"] as const) {
    await signIn(page, role);
    await expect(page.getByRole("button", { name: "Save trip" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Generate plan" })).toBeDisabled();
    await openPlan(page);
    await expect(page.getByRole("button", { name: "Confirm itinerary" })).toHaveCount(0);
    await signOut(page);
  }

  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("unconfigured root shows mock login without changing the local host", async ({ page }) => {
  const failures: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  await page.goto("/");
  await expect(page).toHaveURL("/");
  await expect(page.getByText("Use a mock account to try each role.")).toBeVisible();
  await expect(page.locator('button[name="account"]')).toHaveCount(4);
  expect(page.url()).toBe("http://127.0.0.1:3102/");
  expect(failures).toEqual([]);
});
