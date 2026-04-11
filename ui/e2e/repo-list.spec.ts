/**
 * E2E tests for the repository list page (home page).
 *
 * Covers: repo table rendering, add-repo form (local & remote), delete,
 * empty state, and error handling.
 */
import { test, expect, loc, REPOS } from "./fixtures";

test.describe("Repo list page", () => {
  test("shows the heading", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Repositories" })).toBeVisible();
  });

  test("renders repo table with correct data", async ({ page }) => {
    await page.goto("/");

    for (const repo of REPOS) {
      await expect(page.getByRole("main").getByRole("link", { name: repo.name })).toBeVisible();
    }
    await expect(page.getByText("/home/dev/acme-api")).toBeVisible();
    await expect(page.getByText("https://github.com/org/widget-lib.git")).toBeVisible();

    await expect(page).toHaveScreenshot("repo-list-table.png");
  });

  test("shows ref count badges for ready repos", async ({ page }) => {
    await page.goto("/");

    const badges = page.locator(".ref-badge");
    await expect(badges).toHaveCount(2);
  });

  test("navigates to repo detail when clicking repo name", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("main").getByRole("link", { name: "acme-api" }).click();
    await expect(page).toHaveURL("/acme-api");
  });

  test("shows empty state when no repos exist", async ({ page }) => {
    await page.route("**/api/repos", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: [] });
      } else {
        await route.continue();
      }
    });
    await page.goto("/");
    await expect(page.getByText("No repositories yet")).toBeVisible();

    await expect(page).toHaveScreenshot("repo-list-empty.png");
  });


  test("add button is disabled when form is empty", async ({ page }) => {
    await page.goto("/");
    const addBtn = page.getByRole("button", { name: "Add" });
    await expect(addBtn).toBeDisabled();
  });

  test("can add a local repo", async ({ page }) => {
    let postBody: Record<string, unknown> | null = null;
    await page.route("**/api/repos", async (route) => {
      if (route.request().method() === "POST") {
        postBody = route.request().postDataJSON();
        await route.fulfill({
          status: 201,
          json: {
            name: "new-repo",
            localPath: "/tmp/new-repo",
            remoteUrl: null,
            tokenConfigured: false,
            mirrorStatus: "cloning",
            mirrorError: null,
            refs: [],
          },
        });
      } else {
        await route.fulfill({ json: REPOS });
      }
    });

    await page.goto("/");
    await page.getByPlaceholder("Repository name").fill("new-repo");
    await expect(loc.sourceTab(page, "Local")).toHaveClass(/active/);
    await page.getByPlaceholder(/Path on disk/).fill("/tmp/new-repo");

    await expect(page).toHaveScreenshot("repo-list-add-local-filled.png");

    await page.getByRole("button", { name: "Add" }).click();
    expect(postBody).toEqual({
      name: "new-repo",
      localPath: "/tmp/new-repo",
    });
  });

  test("can switch to remote source and fill URL", async ({ page }) => {
    await page.goto("/");
    await loc.sourceTab(page, "Remote").click();

    await expect(page.getByPlaceholder(/Path on disk/)).toHaveCount(0);
    await expect(page.getByPlaceholder(/Git URL/)).toBeVisible();

    await expect(page).toHaveScreenshot("repo-list-remote-tab.png");
  });

  test("shows token status for remote URLs", async ({ page }) => {
    await page.goto("/");
    await loc.sourceTab(page, "Remote").click();
    await page.getByPlaceholder(/Git URL/).fill("https://github.com/org/test.git");
    await expect(page.getByText("Token found")).toBeVisible();

    await expect(page).toHaveScreenshot("repo-list-token-found.png");
  });

  test("shows missing token for unknown host", async ({ page }) => {
    await page.goto("/");
    await loc.sourceTab(page, "Remote").click();
    await page.getByPlaceholder(/Git URL/).fill("https://gitlab.example.com/org/test.git");
    await expect(page.getByText("No token for this host")).toBeVisible();

    await expect(page).toHaveScreenshot("repo-list-token-missing.png");
  });


  test("can delete a repo", async ({ page }) => {
    let deleteCalled = false;
    await page.route("**/api/repos/acme-api", async (route) => {
      if (route.request().method() === "DELETE") {
        deleteCalled = true;
        await route.fulfill({ status: 204 });
      } else {
        await route.continue();
      }
    });

    await page.goto("/");
    const deleteButtons = page.getByRole("button", { name: "Delete repo" });
    await deleteButtons.first().click();
    expect(deleteCalled).toBe(true);
  });


  test("shows error when add repo fails", async ({ page }) => {
    await page.route("**/api/repos", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 400,
          json: { error: "Repository already exists." },
        });
      } else {
        await route.fulfill({ json: REPOS });
      }
    });

    await page.goto("/");
    await page.getByPlaceholder("Repository name").fill("duplicate");
    await page.getByPlaceholder(/Path on disk/).fill("/tmp/dup");
    await page.getByRole("button", { name: "Add" }).click();

    await expect(loc.errorMessage(page)).toContainText("Repository already exists.");

    await expect(page).toHaveScreenshot("repo-list-add-error.png");
  });
});
