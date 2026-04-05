/**
 * E2E tests for the repo detail page.
 *
 * Covers: metadata display, sync form, indexed refs table, delete ref,
 * navigation links (browse, symbols, context builder).
 */
import { test, expect, loc, fillRefPicker, expectApiError, REPOS } from "./fixtures";

test.describe("Repo detail page", () => {
  test("shows repo name and metadata", async ({ page }) => {
    await page.goto("/acme-api");

    await expect(page.getByRole("heading", { name: "acme-api" })).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: "main" })).toBeVisible();
    await expect(page.getByText("/home/dev/acme-api")).toBeVisible();

    await expect(page).toHaveScreenshot("repo-detail-local.png");
  });

  test("shows back link to repos list", async ({ page }) => {
    await page.goto("/acme-api");

    const backLink = loc.backLink(page);
    await expect(backLink).toBeVisible();
    await backLink.click();
    await expect(page).toHaveURL("/");
  });

  test("shows remote repo metadata with auth status", async ({ page }) => {
    await page.goto("/widget-lib");

    await expect(page.getByText("https://github.com/org/widget-lib.git")).toBeVisible();
    await expect(page.getByText("Token configured")).toBeVisible();

    await expect(page).toHaveScreenshot("repo-detail-remote.png");
  });

  test("shows Context Builder quick-action link", async ({ page }) => {
    await page.goto("/acme-api");

    const ctxLink = page.getByRole("link", { name: "Context Builder" });
    await expect(ctxLink).toBeVisible();
    await ctxLink.click();
    await expect(page).toHaveURL("/acme-api/context");
  });

  // ── Sync form ──

  test("has a sync form with ref input and submit button", async ({ page }) => {
    await page.goto("/acme-api");

    const syncBtn = page.getByRole("button", { name: "Sync" });
    await expect(syncBtn).toBeDisabled();
  });

  // ── Glob settings ──

  test("shows glob settings section with save button", async ({ page }) => {
    await page.goto("/acme-api");

    const saveBtn = page.getByRole("button", { name: "Save" });
    await expect(saveBtn).toBeVisible();
  });

  test("can update glob patterns via PATCH", async ({ page }) => {
    let patchBody: Record<string, unknown> | null = null;
    await page.route("**/api/repos/acme-api", async (route) => {
      if (route.request().method() === "PATCH") {
        patchBody = route.request().postDataJSON();
        await route.fulfill({ json: { ...REPOS[0], ...patchBody } });
      } else {
        await route.continue();
      }
    });

    await page.goto("/acme-api");
    const globInput = page.getByPlaceholder("e.g. src/**/*.ts,!**/vendor/**");
    await globInput.fill("src/**/*.ts");
    await page.getByRole("button", { name: "Save" }).click();

    expect(patchBody).toEqual({ globPatterns: ["src/**/*.ts"] });
  });

  test("can submit sync and shows success message", async ({ page }) => {
    let syncBody: Record<string, unknown> | null = null;
    await page.route("**/api/repos/acme-api/sync", async (route) => {
      syncBody = route.request().postDataJSON();
      await route.fulfill({ json: { message: "Sync enqueued" } });
    });

    await page.goto("/acme-api");
    await fillRefPicker(page, "v2.0.0");
    await page.getByRole("button", { name: "Sync" }).click();
    await expect(page.getByText("Sync enqueued for v2.0.0")).toBeVisible();

    await expect(page).toHaveScreenshot("repo-detail-sync-success.png");
  });

  test("shows error when sync fails", async ({ page }) => {
    await page.goto("/acme-api");
    await fillRefPicker(page, "nonexistent");

    await expectApiError({
      page,
      routePattern: "**/api/repos/acme-api/sync",
      status: 400,
      errorJson: { error: "Ref not found." },
      action: () => page.getByRole("button", { name: "Sync" }).click(),
    });

    await expect(page).toHaveScreenshot("repo-detail-sync-error.png");
  });

  // ── Indexed refs table ──

  test("displays indexed refs in a table", async ({ page }) => {
    await page.goto("/acme-api");

    await expect(page.getByText("abc12345")).toBeVisible();
  });

  test("shows Browse and Symbols links for ready refs", async ({ page }) => {
    await page.goto("/acme-api");

    await expect(page.getByRole("link", { name: "Browse" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Symbols" })).toBeVisible();
  });

  test("Browse link navigates to file browser", async ({ page }) => {
    await page.goto("/acme-api");
    await page.getByRole("link", { name: "Browse" }).click();
    await expect(page).toHaveURL("/acme-api/main/browse");
  });

  test("Symbols link navigates to symbol explorer", async ({ page }) => {
    await page.goto("/acme-api");
    await page.getByRole("link", { name: "Symbols" }).click();
    await expect(page).toHaveURL("/acme-api/main/symbols");
  });

  test("can delete a ref", async ({ page }) => {
    let deleteCalled = false;
    await page.route("**/api/repos/acme-api/versions/main", async (route) => {
      deleteCalled = true;
      await route.fulfill({ status: 204 });
    });

    await page.goto("/acme-api");
    await page.getByRole("button", { name: "Delete ref" }).click();
    expect(deleteCalled).toBe(true);
  });

  // ── Empty state ──

  test("shows empty state when no refs are indexed", async ({ page }) => {
    await page.route("**/api/repos/acme-api", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: { ...REPOS[0], refs: [] } });
      } else {
        await route.continue();
      }
    });

    await page.goto("/acme-api");
    await expect(page.getByText("No indexed refs yet")).toBeVisible();

    await expect(page).toHaveScreenshot("repo-detail-empty-refs.png");
  });

  // ── 404 ──

  test("shows indexing error when ref stage is error", async ({ page }) => {
    await page.route("**/api/repos/acme-api", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          json: {
            ...REPOS[0],
            refs: [
              {
                ref: "main",
                stage: "error",
                commitSha: "abc12345deadbeef",
                indexingError: "Embedding failed: OLLAMA_HOST is unreachable",
              },
            ],
          },
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/acme-api");
    await expect(page.getByText("Embedding failed: OLLAMA_HOST is unreachable")).toBeVisible();

    await expect(page).toHaveScreenshot("repo-detail-indexing-error.png");
  });

  test("shows error for unknown repo", async ({ page }) => {
    await page.route("**/api/repos/unknown-repo", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 404, json: { error: "Not found" } });
      } else {
        await route.continue();
      }
    });

    await page.goto("/unknown-repo");
    await expect(page.getByText("Repository not found")).toBeVisible();

    await expect(page).toHaveScreenshot("repo-detail-not-found.png");
  });
});
