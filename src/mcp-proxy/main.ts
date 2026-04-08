#!/usr/bin/env node
/**
 * MCP proxy entrypoint.
 *
 * A lightweight local wrapper that:
 *   1. Detects the host project's languages from the working directory
 *   2. Connects to a remote RepoRelay MCP server
 *   3. Exposes a stdio MCP interface to the local IDE / agent
 *   4. Injects detected languages into every language-aware tool call
 *
 * Usage:
 *   npx reporelay --server https://reporelay.example.com/mcp
 *
 * Or via environment variable:
 *   REPORELAY_URL=https://reporelay.example.com/mcp npx reporelay
 */
import { parseArgs } from "node:util";
import pino from "pino";
import { loadProxyConfig, parseLanguageFilter } from "./config.js";
import { detectLanguagesFromDir } from "./languages.js";
import { startProxy } from "./proxy-server.js";

// ── CLI argument parsing ──

const { values } = parseArgs({
  options: {
    server: { type: "string", short: "s" },
  },
  strict: false,
  allowPositionals: true,
});

// ── Main ──

async function main(): Promise<void> {
  const config = loadProxyConfig(process.env, values.server as string | undefined);

  // Write logs to stderr (fd 2) so stdout stays clean for the MCP stdio transport.
  const logger = pino({
    level: config.LOG_LEVEL,
    transport: { target: "pino-pretty", options: { colorize: true, destination: 2 } },
  });

  // Resolve upstream URL
  const upstreamUrl = config.REPORELAY_URL;
  if (!upstreamUrl) {
    logger.fatal("No upstream URL configured. Set REPORELAY_URL or pass --server <url>.");
    process.exit(1);
  }

  // Resolve language filter
  const threshold = config.MCP_LANGUAGE_THRESHOLD;
  let languages = parseLanguageFilter(config.MCP_LANGUAGES);

  if (threshold === 0) {
    logger.info("Language-based repo filtering disabled (MCP_LANGUAGE_THRESHOLD=0)");
  } else if (languages) {
    logger.info({ languages, threshold }, "Language filter active (MCP_LANGUAGES)");
  } else {
    const detected = await detectLanguagesFromDir(process.cwd());
    if (detected.length > 0) {
      languages = detected;
      logger.info(
        { languages, threshold, cwd: process.cwd() },
        "Auto-detected languages from working directory",
      );
    } else {
      logger.info("No languages detected — serving all languages");
    }
  }

  await startProxy({ upstreamUrl, languages, logger });
}

main().catch((err) => {
  console.error("MCP proxy failed to start:", err);
  process.exit(1);
});
