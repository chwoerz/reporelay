/**
 * tsup configuration for the reporelay MCP proxy npm package.
 *
 * Bundles the four internal source files into a single ESM entry point
 * while keeping runtime dependencies external (they are listed in
 * package.json and installed by the consumer).
 */
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["main.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: true,
  splitting: false,
  external: ["@modelcontextprotocol/sdk", "pino", "pino-pretty", "zod"],
});
