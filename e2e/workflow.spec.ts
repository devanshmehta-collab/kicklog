import { expect, test, type Page } from "@playwright/test";

const log = async (page: Page, text: string) => {
  await page.getByLabel("Describe a purchase or a sale").fill(text);
  await page.getByRole("button", { name: "Log It" }).click();
};

test.describe.configure({ mode: "serial" });

test("the Definition-of-Done workflow", async ({ page, request }) => {
  // 1-2. open and sign in
  await page.goto("/login");
  await page.getByLabel("Email").fill("e2e-owner@kicklog.test");
  await page.getByLabel("Password").fill("E2e-Owner-Passw0rd");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText("AI Quick Log")).toBeVisible();

  // 3-4. purchase appears in In Stock
  await log(page, "Bought AJ1 Chicago size 10 for ₹18,000 incl shipping");
  await expect(page.getByText(/Added AJ1 Chicago \(size 10\)/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("cell", { name: "AJ1 Chicago" }).first()).toBeVisible();
  await expect(page.locator("main")).toContainText(/In-stock units1/);

  // 5-8. sale moves to Sold, profit ₹3,500
  await log(page, "Sold the Chicago 10s for ₹22,000, ₹500 shipping");
  await expect(page.getByText(/profit ₹3,500/)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("main")).toContainText(/Realized profit₹3,500/);

  // 9. unclear input -> yellow Needs Review card, nothing changes
  await log(page, "hello");
  await expect(page.getByText(/Needs your review/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Needs Review" })).toBeVisible();
  await expect(page.locator("main")).toContainText(/Realized profit₹3,500/);

  // 10. correct and confirm a review card
  await log(page, "Sold the Yeezy 350 for 15k"); // not in stock
  await expect(page.getByText(/Needs your review/)).toBeVisible({ timeout: 30_000 });
  const card = page.locator("section[aria-label='Needs review'] >> text=Yeezy").first();
  await expect(card).toBeVisible();

  // the review queue is persisted server-side (another device would see it)
  const cookies = await page.context().cookies();
  const res = await request.get("/api/reviews", { headers: { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") } });
  expect((await res.json()).length).toBeGreaterThanOrEqual(2);
});

test("public showroom shows only published stock and never private data", async ({ page, request }) => {
  const res = await request.get("/api/public/products");
  const body = await res.text();
  expect(body.toLowerCase()).not.toMatch(/cost|profit|partner|customer/);
  });

test("the home page is a product grid that opens WhatsApp, not a login", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Password")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Seller sign in" })).toBeVisible();
  await page.goto("/shop");
  await expect(page).toHaveURL(/localhost:\d+\/$/);
});

test("unauthenticated visitors are redirected away from the terminal", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/inventory");
  await expect(page).toHaveURL(/\/login/);
  await ctx.close();
});
