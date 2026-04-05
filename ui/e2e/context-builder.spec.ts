/**
 * E2E tests for the context builder page.
 *
 * Covers: form fields, strategy selection, building context pack,
 * result display with chunk breakdown and copy button.
 */
import { test, expect, loc, expectApiError, CONTEXT_PACK_RESULT } from "./fixtures";

test.describe("Context builder page", () => {
  test("shows heading and breadcrumb", async ({ page }) => {
    await page.goto("/acme-api/context");

    await expect(page.getByRole("heading", { name: "Context Builder" })).toBeVisible();
    await expect(page.getByText("Build task-specific code context packs")).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "acme-api" })).toBeVisible();

    await expect(page).toHaveScreenshot("context-builder-form.png");
  });

  test("shows back link to repos", async ({ page }) => {
    await page.goto("/acme-api/context");

    const backLink = loc.backLink(page);
    await expect(backLink).toBeVisible();
    await backLink.click();
    await expect(page).toHaveURL("/");
  });

  test("shows strategy selector with default value", async ({ page }) => {
    await page.goto("/acme-api/context");

    const select = page.locator("select.select");
    await expect(select).toHaveValue("explain");
  });

  test("shows from-ref field when recent-changes strategy is selected", async ({ page }) => {
    await page.goto("/acme-api/context");

    await expect(page.getByText("From ref (base)")).toHaveCount(0);

    await page.locator("select.select").selectOption("recent-changes");

    await expect(page.getByText("From ref (base)")).toBeVisible();

    await expect(page).toHaveScreenshot("context-builder-recent-changes.png");
  });

  test("builds context pack and shows results", async ({ page }) => {
    await page.goto("/acme-api/context");

    const queryInput = page.locator("textarea.input");
    await queryInput.fill("explain the entry point");
    await page.getByRole("button", { name: "Build Context Pack" }).click();

    await expect(page.getByText(`${CONTEXT_PACK_RESULT.totalTokens} tokens`)).toBeVisible();
    await expect(page.getByText(`${CONTEXT_PACK_RESULT.chunks.length} chunks`)).toBeVisible();
    await expect(page.locator(".strategy-badge")).toContainText("explain");
    await expect(page.locator(".chunk-summary-item", { hasText: "src/index.ts" })).toBeVisible();
    await expect(page.getByText("entry point")).toBeVisible();
    await expect(page.locator(".chunk-summary-item", { hasText: "src/routes.ts" })).toBeVisible();

    await expect(page).toHaveScreenshot("context-builder-results.png");
  });

  test("shows Copy button in results", async ({ page }) => {
    await page.goto("/acme-api/context");

    const queryInput = page.locator("textarea.input");
    await queryInput.fill("test");
    await page.getByRole("button", { name: "Build Context Pack" }).click();

    await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();
  });

  test("shows error when build fails", async ({ page }) => {
    await page.goto("/acme-api/context");
    const queryInput = page.locator("textarea.input");
    await queryInput.fill("test");

    await expectApiError({
      page,
      routePattern: "**/api/repos/acme-api/context",
      status: 400,
      errorJson: { error: "No indexed refs found." },
      action: () => page.getByRole("button", { name: "Build Context Pack" }).click(),
    });

    await expect(page).toHaveScreenshot("context-builder-error.png");
  });
});
