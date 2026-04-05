/**
 * E2E tests for the code search page.
 *
 * Covers: search form, results display, empty results, error handling,
 * optional repo/ref filters.
 */
import { test, expect, loc, expectApiError, SEARCH_RESULTS } from "./fixtures";

test.describe("Search page", () => {
  test("shows the heading and search form", async ({ page }) => {
    await page.goto("/search");

    await expect(page.getByRole("heading", { name: "Code Search" })).toBeVisible();
    await expect(page.getByPlaceholder("Search query")).toBeVisible();
    await expect(page.getByPlaceholder("Repo (optional)")).toBeVisible();
    await expect(page.getByPlaceholder("Ref (optional)")).toBeVisible();
    await expect(page.getByRole("button", { name: "Search", exact: true })).toBeVisible();

    await expect(page).toHaveScreenshot("search-empty-form.png");
  });

  test("performs a search and shows results", async ({ page }) => {
    await page.goto("/search");

    await page.getByPlaceholder("Search query").fill("hello world");
    await page.getByRole("button", { name: "Search", exact: true }).click();

    await expect(page.getByText(`${SEARCH_RESULTS.length} result(s)`)).toBeVisible();
    await expect(page.getByText("acme-api@main")).toBeVisible();
    await expect(page.getByText("src/index.ts")).toBeVisible();
    await expect(page.getByText("0.912")).toBeVisible();
    await expect(page.getByText("widget-lib@v1.0.0")).toBeVisible();
    await expect(page.getByText("lib/widget.ts")).toBeVisible();

    await expect(page).toHaveScreenshot("search-results.png");
  });

  test("sends repo and ref filters in the request", async ({ page }) => {
    let searchUrl = "";
    await page.route("**/api/search**", async (route) => {
      searchUrl = route.request().url();
      await route.fulfill({ json: SEARCH_RESULTS });
    });

    await page.goto("/search");
    await page.getByPlaceholder("Search query").fill("test query");
    await page.getByPlaceholder("Repo (optional)").fill("acme-api");
    await page.getByPlaceholder("Ref (optional)").fill("main");
    await page.getByRole("button", { name: "Search", exact: true }).click();

    expect(searchUrl).toContain("query=test%20query");
    expect(searchUrl).toContain("repo=acme-api");
    expect(searchUrl).toContain("ref=main");
  });

  test("shows empty state when no results found", async ({ page }) => {
    await page.route("**/api/search**", async (route) => {
      await route.fulfill({ json: [] });
    });

    await page.goto("/search");
    await page.getByPlaceholder("Search query").fill("nonexistent");
    await page.getByRole("button", { name: "Search", exact: true }).click();

    await expect(page.getByText("No results found.")).toBeVisible();

    await expect(page).toHaveScreenshot("search-no-results.png");
  });

  test("shows error message on search failure", async ({ page }) => {
    await page.goto("/search");
    await page.getByPlaceholder("Search query").fill("broken");

    await expectApiError({
      page,
      routePattern: "**/api/search**",
      status: 500,
      errorJson: { error: "Embedding service unavailable." },
      action: () => page.getByRole("button", { name: "Search", exact: true }).click(),
    });

    await expect(page).toHaveScreenshot("search-error.png");
  });

  test("result card links to file browser", async ({ page }) => {
    await page.goto("/search");
    await page.getByPlaceholder("Search query").fill("hello");
    await page.getByRole("button", { name: "Search", exact: true }).click();

    const link = page.getByRole("link", { name: "acme-api@main" });
    await expect(link).toHaveAttribute("href", /\/acme-api\/main\/browse\?path=src%2Findex\.ts/);
  });
});
