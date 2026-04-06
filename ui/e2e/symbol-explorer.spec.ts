/**
 * E2E tests for the symbol explorer page.
 *
 * Covers: symbol search form, find results, symbol detail panel,
 * file search mode, and navigation.
 */
import { test, expect, loc, expectApiError, FIND_SYMBOLS, SYMBOL_DETAIL } from "./fixtures";

test.describe("Symbol explorer page", () => {
  test("shows heading and breadcrumb", async ({ page }) => {
    await page.goto("/acme-api/main/symbols");

    await expect(page.getByRole("heading", { name: "Symbol Explorer" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "acme-api" })).toBeVisible();
    await expect(page.locator(".breadcrumb")).toContainText("Symbols");

    await expect(page).toHaveScreenshot("symbol-explorer-form.png");
  });

  test("has a search form with pattern input and kind selector", async ({ page }) => {
    await page.goto("/acme-api/main/symbols");

    await expect(page.getByPlaceholder("Search symbols or files")).toBeVisible();
    await expect(page.locator("select.select")).toHaveValue("symbol");
    await expect(page.getByRole("button", { name: "Find" })).toBeVisible();
  });

  test("searches for symbols and shows results", async ({ page }) => {
    await page.goto("/acme-api/main/symbols");

    await page.getByPlaceholder("Search symbols or files").fill("hello");
    await page.getByRole("button", { name: "Find" }).click();

    for (const sym of FIND_SYMBOLS) {
      await expect(page.locator("button.action-list-item", { hasText: sym.name })).toBeVisible();
    }

    await expect(page).toHaveScreenshot("symbol-explorer-results.png");
  });

  test("shows empty state when no matches found", async ({ page }) => {
    await page.route("**/api/repos/*/refs/*/find**", async (route) => {
      await route.fulfill({ json: [] });
    });

    await page.goto("/acme-api/main/symbols");
    await page.getByPlaceholder("Search symbols or files").fill("nonexistent");
    await page.getByRole("button", { name: "Find" }).click();

    await expect(page.getByText("No matches found.")).toBeVisible();

    await expect(page).toHaveScreenshot("symbol-explorer-no-matches.png");
  });

  test("clicking a symbol shows its detail", async ({ page }) => {
    await page.goto("/acme-api/main/symbols");

    await page.getByPlaceholder("Search symbols or files").fill("hello");
    await page.getByRole("button", { name: "Find" }).click();
    await page.locator("button.action-list-item", { hasText: "hello" }).click();

    await expect(page.getByRole("heading", { name: "hello" })).toBeVisible();
    await expect(page.locator(".sig")).toContainText(SYMBOL_DETAIL.symbols[0]!.signature);
    await expect(page.locator(".sym-doc")).toContainText(SYMBOL_DETAIL.symbols[0]!.documentation!);

    await expect(page).toHaveScreenshot("symbol-explorer-detail.png");
  });

  test("symbol detail shows imports section", async ({ page }) => {
    await page.goto("/acme-api/main/symbols");

    await page.getByPlaceholder("Search symbols or files").fill("hello");
    await page.getByRole("button", { name: "Find" }).click();
    await page.locator("button.action-list-item", { hasText: "hello" }).click();

    await expect(page.getByText("Imported by")).toBeVisible();
    await expect(page.getByText("src/routes.ts")).toBeVisible();
    await expect(page.getByText('"./index"')).toBeVisible();
  });

  test("can switch to file search mode", async ({ page }) => {
    await page.goto("/acme-api/main/symbols");

    await page.locator("select.select").selectOption("file");

    await page.getByPlaceholder("Search symbols or files").fill("index");
    await page.getByRole("button", { name: "Find" }).click();

    await expect(page.getByText("src/index.ts")).toBeVisible();
    await expect(page.getByText("src/routes.ts")).toBeVisible();

    await expect(page).toHaveScreenshot("symbol-explorer-file-mode.png");
  });

  test("switching kind re-searches with the new kind", async ({ page }) => {
    await page.goto("/acme-api/main/symbols");

    await page.getByPlaceholder("Search symbols or files").fill("hello");
    await page.getByRole("button", { name: "Find" }).click();

    for (const sym of FIND_SYMBOLS) {
      await expect(page.locator("button.action-list-item", { hasText: sym.name })).toBeVisible();
    }

    await page.locator("select.select").selectOption("file");

    await expect(page.getByText("src/index.ts")).toBeVisible();
    await expect(page.getByText("src/routes.ts")).toBeVisible();
  });

  test("shows error on search failure", async ({ page }) => {
    await page.goto("/acme-api/main/symbols");
    await page.getByPlaceholder("Search symbols or files").fill("test");

    await expectApiError({
      page,
      routePattern: "**/api/repos/*/refs/*/find**",
      status: 500,
      errorJson: { error: "Internal error." },
      action: () => page.getByRole("button", { name: "Find" }).click(),
    });

    await expect(page).toHaveScreenshot("symbol-explorer-error.png");
  });
});
