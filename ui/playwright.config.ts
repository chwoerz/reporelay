/**
 * Playwright E2E test configuration for RepoRelay UI.
 *
 * Tests use route-level API mocking — no live backend required.
 * The Angular dev server is started automatically on port 4200.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  snapshotDir: "./e2e/__screenshots__",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: process.env["CI"] ? 1 : undefined,
  reporter: "html",
  timeout: 30_000,

  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    },
  },

  use: {
    baseURL: "http://localhost:4200",
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "npx ng serve --port 4200",
    url: "http://localhost:4200",
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
