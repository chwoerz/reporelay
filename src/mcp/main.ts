/**
 * MCP server entrypoint.
 *
 * Bootstraps DB, creates embedder, then starts the MCP server
 * (stdio or HTTP transport). Migrations are handled by the worker.
 */
import { bootstrap, setupGracefulShutdown } from "../core/index.js";
import { parseLanguageFilter } from "../core/config.js";
import { detectLanguagesFromDir } from "../git/language-detector.js";
import { startMcpServer } from "./server.js";

async function main(): Promise<void> {
  const { config, logger, sql, db, embedder } = await bootstrap();

  logger.info({ transport: config.MCP_TRANSPORT }, "Starting MCP server…");

  // Resolve language filter: explicit env var takes priority, then auto-detect from CWD.
  // Threshold of 0 disables language-based repo filtering entirely.
  const languageThreshold = config.MCP_LANGUAGE_THRESHOLD;
  let languages = parseLanguageFilter(config.MCP_LANGUAGES);

  if (languageThreshold === 0) {
    logger.info("Language-based repo filtering disabled (MCP_LANGUAGE_THRESHOLD=0)");
    // Still honour MCP_LANGUAGES for per-file filtering in search/find,
    // but skip auto-detection since repo filtering is off.
  } else if (languages) {
    logger.info(
      { languages, threshold: languageThreshold },
      "Language filter active (MCP_LANGUAGES) — only these languages will be served",
    );
  } else {
    const detected = await detectLanguagesFromDir(process.cwd());
    if (detected.length > 0) {
      languages = detected;
      logger.info(
        { languages, threshold: languageThreshold, cwd: process.cwd() },
        "Auto-detected languages from working directory — filtering repos accordingly",
      );
    } else {
      logger.info("No languages detected from working directory — serving all languages");
    }
  }

  // Start MCP server
  await startMcpServer({ db, embedder, config, languages, languageThreshold });

  if (config.MCP_TRANSPORT === "http") {
    logger.info({ port: config.MCP_SERVER_PORT }, "MCP server listening (HTTP)");

    // Graceful shutdown (HTTP mode only — stdio is managed by the client)
    setupGracefulShutdown(logger, "MCP server", [async () => sql.end()]);
  } else {
    logger.info("MCP server connected (stdio)");
  }
}

main().catch((err) => {
  console.error("MCP server failed to start:", err);
  process.exit(1);
});
