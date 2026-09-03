import { expect, test } from "@playwright/test";
import { trip, proposal } from "../components/planning-fixtures";

test("saved trip, proposal review, confirmation and reload", async ({ page }, testInfo) => {
  let savedTrip = { ...trip };
  let proposals: ReturnType<typeof proposal>[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/trips**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/decision")) {
      const accepted = request.postDataJSON().decision === "accept";
      proposals[0] = { ...proposals[0], status: accepted ? "accepted" : "rejected" };
      if (accepted) savedTrip = { ...savedTrip, activeProposalId: proposals[0].id };
      return route.fulfill({ json: { proposal: proposals[0] } });
    }
    if (path.endsWith("/proposals")) {
      proposals = [proposal()];
      return route.fulfill({ status: 201, json: { proposal: proposals[0] } });
    }
    if (request.method() === "PATCH") {
      savedTrip = { ...savedTrip, ...request.postDataJSON() };
      return route.fulfill({ json: { trip: savedTrip } });
    }
    return route.fulfill({ json: path === "/api/trips" ? { trips: [savedTrip] } : { trip: savedTrip, proposals } });
  });
  await page.goto("/");
  await expect(page.getByLabel("Destination", { exact: true })).toHaveValue("Penang");
  await expect(page.getByRole("button", { name: /people|provider health|plan b/i })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("trip-setup.png"), fullPage: true });
  await page.getByRole("button", { name: /generate plan/i }).click();
  await expect(page.getByText("A morning in George Town")).toBeVisible();
  await expect(page.getByText("Time for local food")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("proposal-review.png"), fullPage: true });
  await page.getByRole("button", { name: /confirm itinerary/i }).click();
  await expect(page.getByRole("button", { name: /confirm itinerary/i })).toHaveCount(0);
  await page.reload();
  await page.getByRole("tab", { name: "Plan", exact: true }).click();
  await expect(page.getByText("Market visit")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("unconfigured sign-in renders clearly at both sizes", async ({ page }, testInfo) => {
  await page.goto("/?view=login");
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /send.*link|sign in/i })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("login.png"), fullPage: true });
});
