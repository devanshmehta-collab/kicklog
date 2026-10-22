import { expect, test } from "@playwright/test";

test("Quick Log is usable on a phone without horizontal scrolling", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("e2e-owner@kicklog.test");
  await page.getByLabel("Password").fill("E2e-Owner-Passw0rd");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByLabel("Describe a purchase or a sale")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log It" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
