/**
 * E2E tests for the file browser page.
 *
 * Covers: file tree rendering, file selection, file content display,
 * symbol chips, and filter input.
 */
import { test, expect, loc, FILE_TREE, FILE_CONTENT } from "./fixtures";

test.describe("File browser page", () => {
  test("shows breadcrumb with repo and ref", async ({ page }) => {
    await page.goto("/acme-api/main/browse");

    await expect(page.getByRole("main").getByRole("link", { name: "acme-api" })).toBeVisible();
    await expect(page.getByText("main")).toBeVisible();
  });

  test("shows back link", async ({ page }) => {
    await page.goto("/acme-api/main/browse");

    await expect(loc.backLink(page)).toBeVisible();
  });

  test("renders file tree", async ({ page }) => {
    await page.goto("/acme-api/main/browse");

    await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
    for (const path of FILE_TREE) {
      await expect(page.locator(".tree-file", { hasText: path })).toBeVisible();
    }

    await expect(page).toHaveScreenshot("file-browser-tree.png");
  });

  test("shows placeholder text before selecting a file", async ({ page }) => {
    await page.goto("/acme-api/main/browse");

    await expect(page.getByText("Select a file from the tree")).toBeVisible();
  });

  test("shows file content when a file is clicked", async ({ page }) => {
    await page.goto("/acme-api/main/browse");

    await page.locator(".tree-file", { hasText: "src/index.ts" }).click();
    await expect(page.locator(".file-path-display")).toContainText(FILE_CONTENT.path);
    await expect(page.getByText("1 symbol(s)")).toBeVisible();
    await expect(page.locator(".chip", { hasText: "app" })).toBeVisible();

    await expect(page).toHaveScreenshot("file-browser-content.png");
  });

  test("filters files in the tree", async ({ page }) => {
    await page.goto("/acme-api/main/browse");

    await page.getByPlaceholder("Filter files").fill("helpers");

    await expect(page.locator(".tree-file")).toHaveCount(1);
    await expect(page.locator(".tree-file")).toContainText("src/utils/helpers.ts");

    await expect(page).toHaveScreenshot("file-browser-filtered.png");
  });

  test("shows all files when filter is cleared", async ({ page }) => {
    await page.goto("/acme-api/main/browse");

    await page.getByPlaceholder("Filter files").fill("helpers");
    await expect(page.locator(".tree-file")).toHaveCount(1);

    await page.getByPlaceholder("Filter files").fill("");
    await expect(page.locator(".tree-file")).toHaveCount(FILE_TREE.length);
  });

  test("opens file from query param", async ({ page }) => {
    await page.goto("/acme-api/main/browse?path=src/index.ts");

    await expect(page.locator(".file-path-display")).toContainText("src/index.ts");

    await expect(page).toHaveScreenshot("file-browser-query-param.png");
  });
});
