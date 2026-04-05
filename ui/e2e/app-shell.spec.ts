/**
 * E2E tests for the app shell: toolbar, brand link, and navigation links.
 */
import { test, expect } from "./fixtures";

test.describe("App shell", () => {
  test("displays the toolbar with brand and nav links", async ({ page }) => {
    await page.goto("/");

    const brand = page.locator("a.brand");
    await expect(brand).toContainText("RepoRelay");
    await expect(page.getByRole("link", { name: "Repos" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Search" })).toBeVisible();

    await expect(page).toHaveScreenshot("app-shell-toolbar.png");
  });

  test("navigates to search page via nav link", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Search" }).click();
    await expect(page).toHaveURL("/search");
    await expect(page.getByText("Code Search")).toBeVisible();

    await expect(page).toHaveScreenshot("app-shell-search-nav.png");
  });

  test("navigates back to repos page via brand link", async ({ page }) => {
    await page.goto("/search");
    await page.locator("a.brand").click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "Repositories" })).toBeVisible();
  });

  test("navigates back to repos page via Repos nav link", async ({ page }) => {
    await page.goto("/search");
    await page.getByRole("link", { name: "Repos" }).click();
    await expect(page).toHaveURL("/");
  });
});
