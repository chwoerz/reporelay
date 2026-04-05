/**
 * Reads openapi.yaml and generates src/generated/paths.ts
 * with a const object mapping operationId → Fastify route path.
 *
 * OpenAPI uses {param} for path parameters; Fastify uses :param.
 *
 * Usage: tsx scripts/generate-paths.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const spec = parse(readFileSync(resolve(root, "openapi.yaml"), "utf-8"));

const entries: { operationId: string; path: string }[] = [];

for (const [path, methods] of Object.entries(
  spec.paths as Record<string, Record<string, unknown>>,
)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (typeof operation !== "object" || operation === null) continue;
    const op = operation as Record<string, unknown>;
    if (!op.operationId) continue;

    // Convert OpenAPI {param} → Fastify :param
    const fastifyPath = path.replace(/\{(\w+)\}/g, ":$1");
    entries.push({ operationId: op.operationId as string, path: fastifyPath });
  }
}

// Sort by operationId for stable output
entries.sort((a, b) => a.operationId.localeCompare(b.operationId));

const lines = [
  "// ⚠️  AUTO-GENERATED from openapi.yaml — do not edit manually.",
  "// Regenerate with: pnpm generate:api",
  "",
  "export const apiPaths = {",
  ...entries.map((e) => `  ${e.operationId}: "${e.path}",`),
  "} as const;",
  "",
  "export type ApiPathKey = keyof typeof apiPaths;",
  "",
];

const outPath = resolve(root, "src/generated/paths.ts");
writeFileSync(outPath, lines.join("\n"), "utf-8");
console.log(`Generated ${outPath} (${entries.length} paths)`);

// Append paths export to the barrel index.ts (kubb's clean: true regenerates it each run)
const barrelPath = resolve(root, "src/generated/index.ts");
const barrel = readFileSync(barrelPath, "utf-8");
const pathsExport = [
  `export { apiPaths } from "./paths.js";`,
  `export type { ApiPathKey } from "./paths.js";`,
].join("\n");

if (!barrel.includes("./paths.js")) {
  writeFileSync(barrelPath, barrel.trimEnd() + "\n" + pathsExport + "\n", "utf-8");
  console.log("Appended paths exports to barrel index.ts");
}
