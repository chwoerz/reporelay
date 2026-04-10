/**
 * Shared API mock data, route-mocking helpers, and reusable page-object
 * helpers for Playwright tests.
 *
 * Exports a custom `test` fixture that automatically applies API mocks
 * before every test, eliminating the manual `beforeEach` boilerplate.
 */
import { test as base, expect, type Page } from "@playwright/test";

// ── Fixture data ──────────────────────────────────────────────────────

export const REPOS = [
  {
    name: "acme-api",
    localPath: "/home/dev/acme-api",
    remoteUrl: null,
    tokenConfigured: false,
    mirrorStatus: "ready",
    mirrorError: null,
    globPatterns: [],
    refs: [
      { ref: "main", stage: "ready", commitSha: "abc12345deadbeef" },
    ],
  },
  {
    name: "widget-lib",
    localPath: null,
    remoteUrl: "https://github.com/org/widget-lib.git",
    tokenConfigured: true,
    mirrorStatus: "ready",
    mirrorError: null,
    globPatterns: [],
    refs: [
      { ref: "main", stage: "ready", commitSha: "def67890cafebabe" },
      { ref: "v1.0.0", stage: "ready", commitSha: "111222333aaabbb" },
    ],
  },
];

export const GIT_REFS = {
  branches: ["main", "develop", "feature/auth"],
  tags: ["v1.0.0", "v1.1.0", "v2.0.0"],
};

export const SEARCH_RESULTS = [
  {
    repo: "acme-api",
    ref: "main",
    filePath: "src/index.ts",
    startLine: 10,
    endLine: 25,
    score: 0.912,
    content: 'export function hello() {\n  return "world";\n}',
  },
  {
    repo: "widget-lib",
    ref: "v1.0.0",
    filePath: "lib/widget.ts",
    startLine: 1,
    endLine: 8,
    score: 0.845,
    content: "export class Widget {\n  render() { /* ... */ }\n}",
  },
];

export const CONTEXT_PACK_RESULT = {
  strategy: "explain",
  repo: "acme-api",
  ref: "main",
  totalTokens: 2048,
  chunks: [
    {
      filePath: "src/index.ts",
      startLine: 1,
      endLine: 50,
      annotation: "entry point",
    },
    {
      filePath: "src/routes.ts",
      startLine: 10,
      endLine: 30,
      annotation: null,
    },
  ],
  formatted: "// src/index.ts\nexport function hello() { return 'world'; }",
};

export const FILE_TREE = [
  "src/index.ts",
  "src/routes.ts",
  "src/utils/helpers.ts",
  "package.json",
  "README.md",
];

export const FILE_CONTENT = {
  path: "src/index.ts",
  content: 'import express from "express";\n\nconst app = express();\napp.listen(3000);\n',
  symbols: [
    { name: "app", kind: "variable", startLine: 3, endLine: 3 },
  ],
};

export const FIND_SYMBOLS = [
  {
    name: "hello",
    kind: "function",
    filePath: "src/index.ts",
    startLine: 10,
    endLine: 12,
  },
  {
    name: "Widget",
    kind: "class",
    filePath: "lib/widget.ts",
    startLine: 1,
    endLine: 20,
  },
];

export const FIND_FILES = [
  { path: "src/index.ts" },
  { path: "src/routes.ts" },
];

export const SYMBOL_DETAIL = {
  symbols: [
    {
      name: "hello",
      kind: "function",
      filePath: "src/index.ts",
      startLine: 10,
      endLine: 12,
      signature: "function hello(): string",
      documentation: "Returns a greeting string.",
      source: 'function hello(): string {\n  return "world";\n}',
    },
  ],
  imports: [
    {
      filePath: "src/routes.ts",
      source: "./index",
      isDefault: false,
    },
  ],
};

export const INDEXING_STATUS: unknown[] = [];

export const GIT_CREDENTIAL_HOSTS = ["GITHUB_COM"];

// ── Route mocking helper ──────────────────────────────────────────────

/**
 * Intercept all /api/* requests on the given page and respond with
 * deterministic fixture data. Individual tests can override specific
 * routes by calling `page.route()` *after* the auto-mock runs.
 */
export async function mockApi(page: Page) {
  // GET /api/repos
  await page.route("**/api/repos", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: REPOS });
    } else if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      const newRepo = {
        name: body.name,
        localPath: body.localPath ?? null,
        remoteUrl: body.remoteUrl ?? null,
        tokenConfigured: false,
        mirrorStatus: "cloning",
        mirrorError: null,
        globPatterns: body.globPatterns ?? [],
        refs: [],
      };
      await route.fulfill({ json: newRepo, status: 201 });
    } else {
      await route.continue();
    }
  });

  // GET /api/repos/:name
  await page.route("**/api/repos/*", async (route) => {
    const url = route.request().url();
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    if (segments.length > 3) {
      await route.continue();
      return;
    }
    if (route.request().method() === "DELETE") {
      await route.fulfill({ status: 204 });
      return;
    }
    if (route.request().method() === "PATCH") {
      const name = segments[2];
      const repo = REPOS.find((r) => r.name === name);
      const body = route.request().postDataJSON();
      await route.fulfill({ json: { ...repo, ...body } });
      return;
    }
    const name = segments[2];
    const repo = REPOS.find((r) => r.name === name);
    if (repo) {
      await route.fulfill({ json: repo });
    } else {
      await route.fulfill({ status: 404, json: { error: "Not found" } });
    }
  });

  // GET /api/repos/:name/git-refs
  await page.route("**/api/repos/*/git-refs", async (route) => {
    await route.fulfill({ json: GIT_REFS });
  });

  // POST /api/repos/:name/sync
  await page.route("**/api/repos/*/sync", async (route) => {
    await route.fulfill({ json: { message: "Sync enqueued" } });
  });

  // POST /api/repos/:name/refresh-refs
  await page.route("**/api/repos/*/refresh-refs", async (route) => {
    await route.fulfill({ json: GIT_REFS });
  });

  // POST /api/repos/:name/context
  await page.route("**/api/repos/*/context", async (route) => {
    await route.fulfill({ json: CONTEXT_PACK_RESULT });
  });

  // GET /api/repos/:name/refs/:ref/tree
  await page.route("**/api/repos/*/refs/*/tree", async (route) => {
    await route.fulfill({ json: FILE_TREE });
  });

  // GET /api/repos/:name/refs/:ref/file?path=...
  await page.route("**/api/repos/*/refs/*/file**", async (route) => {
    await route.fulfill({ json: FILE_CONTENT });
  });

  // GET /api/repos/:name/refs/:ref/find?...
  await page.route("**/api/repos/*/refs/*/find**", async (route) => {
    const url = new URL(route.request().url());
    const kind = url.searchParams.get("kind");
    if (kind === "file") {
      await route.fulfill({ json: FIND_FILES });
    } else {
      await route.fulfill({ json: FIND_SYMBOLS });
    }
  });

  // GET /api/repos/:name/refs/:ref/symbols/:symbolName
  await page.route("**/api/repos/*/refs/*/symbols/**", async (route) => {
    await route.fulfill({ json: SYMBOL_DETAIL });
  });

  // DELETE /api/repos/:name/versions/:ref
  await page.route("**/api/repos/*/versions/*", async (route) => {
    await route.fulfill({ status: 204 });
  });

  // GET /api/search
  await page.route("**/api/search**", async (route) => {
    await route.fulfill({ json: SEARCH_RESULTS });
  });

  // GET /api/indexing-status
  await page.route("**/api/indexing-status", async (route) => {
    await route.fulfill({ json: INDEXING_STATUS });
  });

  // GET /api/git-credentials/hosts
  await page.route("**/api/git-credentials/hosts", async (route) => {
    await route.fulfill({ json: GIT_CREDENTIAL_HOSTS });
  });
}

// ── Custom test fixture ───────────────────────────────────────────────

/**
 * Extended Playwright `test` that automatically applies `mockApi()` before
 * every test. Import this instead of `@playwright/test`'s default `test`.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await mockApi(page);
    await use(page);
  },
});

export { expect };

// ── Reusable page helpers ─────────────────────────────────────────────

/** Shared locators used across multiple test files. */
export const loc = {
  backLink: (page: Page) => page.locator("a.back-link"),
  errorMessage: (page: Page) => page.locator(".error"),
  refPickerInput: (page: Page) => page.locator("app-ref-picker input"),
  sourceTab: (page: Page, label: "Local" | "Remote") =>
    page.locator(".source-tab", { hasText: label }),
};

/**
 * Fill the ref-picker autocomplete and blur to emit the selected value.
 * Reused in repo-detail (sync) and context-builder pages.
 */
export async function fillRefPicker(page: Page, value: string) {
  const input = loc.refPickerInput(page);
  await input.fill(value);
  await input.blur();
}

/**
 * Override an API route to return an error, then perform a form action
 * and assert the error message appears. Useful for the identical
 * error-state tests across search, context-builder, repo-detail, etc.
 */
export async function expectApiError(opts: {
  page: Page;
  routePattern: string;
  status: number;
  errorJson: { error: string };
  action: () => Promise<void>;
}) {
  await opts.page.route(opts.routePattern, async (route) => {
    await route.fulfill({ status: opts.status, json: opts.errorJson });
  });
  await opts.action();
  await expect(loc.errorMessage(opts.page)).toContainText(opts.errorJson.error);
}
